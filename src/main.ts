import { InstanceBase, runEntrypoint, InstanceStatus } from '@companion-module/base'
import { GetConfigFields, ModuleConfig } from './config.js'
import { OmadaClient, OmadaDevice } from './omada-client.js'
import { UpdateActions } from './actions.js'
import { UpdateFeedbacks } from './feedbacks.js'

/**
 * Main instance class for the Omada Companion module
 */
export class OmadaModuleInstance extends InstanceBase<ModuleConfig> {
	public config: ModuleConfig = {} as ModuleConfig
	public client?: OmadaClient
	private deviceListPollInterval?: NodeJS.Timeout // Poll device list every 60s
	private switchDetailsPollInterval?: NodeJS.Timeout // Poll switch details every 5s for PoE status
	private deviceCache: Map<string, OmadaDevice> = new Map()
	private switchDetailsCache: Map<string, any> = new Map() // Cache switch details for PoE status
	private reconnectTimeout?: NodeJS.Timeout
	private confirmationTimeouts: Map<string, NodeJS.Timeout> = new Map() // Delayed confirmations after PoE toggle
	private isDestroyed = false // Set in destroy() so background work stops touching a dead instance
	private connectionGeneration = 0 // Bumped per connection attempt; stale attempts abandon their results

	/**
	 * Initialize the module instance
	 *
	 * IMPORTANT: this must return promptly. Companion aborts init() after 10 seconds
	 * and kills the module process, which also makes the connection config
	 * un-editable in the UI. Omada controllers routinely need far longer than that
	 * just to log in (8s+ is normal on an OC200), so the connection is started in
	 * the background and its outcome is reported via updateStatus().
	 */
	async init(config: ModuleConfig): Promise<void> {
		this.config = config
		this.isDestroyed = false

		// Initialize actions and feedbacks
		this.updateActions()
		this.updateFeedbacks()

		// Connect to Omada controller if configured
		if (this.config.host && this.config.username && this.config.password) {
			this.updateStatus(InstanceStatus.Connecting)
			// Deliberately not awaited - see the note above
			void this.initConnection()
		} else {
			this.updateStatus(InstanceStatus.BadConfig, 'Missing configuration')
			this.log('warn', 'Module not configured - please configure controller connection')
		}
	}

	/**
	 * Initialize connection to Omada controller
	 *
	 * Never call this with `await` from init()/configUpdated() - it performs several
	 * slow network round-trips and will blow Companion's 10 second RPC deadline.
	 */
	async initConnection(): Promise<void> {
		if (this.isDestroyed) {
			return
		}

		// Any attempt still in flight is now stale and will abandon its result
		const generation = ++this.connectionGeneration
		const isStale = () => this.isDestroyed || generation !== this.connectionGeneration

		const startedAt = Date.now()
		const elapsed = () => ((Date.now() - startedAt) / 1000).toFixed(1)

		try {
			// Create client instance
			const client = new OmadaClient(this.config, (level, message) => {
				this.log(level, message)
			})
			this.client = client

			// Attempt login
			await client.login()
			if (isStale()) {
				return
			}

			// Fetch initial device list
			await this.refreshDevices()
			if (isStale()) {
				return
			}

			// Update status to OK
			this.updateStatus(InstanceStatus.Ok)
			this.log('info', `Connected to Omada controller in ${elapsed()}s`)

			// Start polling for device updates
			this.startPolling()
		} catch (error) {
			const err = error as Error
			if (isStale()) {
				return
			}

			this.log('error', `Failed to connect after ${elapsed()}s: ${err.message}`)
			this.updateStatus(InstanceStatus.ConnectionFailure, err.message)

			// Schedule reconnection attempt
			this.scheduleReconnect()
		}
	}

	/**
	 * Schedule a reconnection attempt
	 */
	private scheduleReconnect(): void {
		if (this.reconnectTimeout) {
			clearTimeout(this.reconnectTimeout)
		}
		if (this.isDestroyed) {
			return
		}

		this.reconnectTimeout = setTimeout(() => {
			this.reconnectTimeout = undefined
			this.log('info', 'Attempting to reconnect...')
			void this.initConnection()
		}, 30000) // Retry every 30 seconds
	}

	/**
	 * Start polling for device updates
	 * - Device list: 10 minutes (switches rarely added/removed)
	 * - Switch details: 5 seconds (for PoE status feedbacks)
	 */
	private startPolling(): void {
		// Clear any existing intervals
		if (this.deviceListPollInterval) {
			clearInterval(this.deviceListPollInterval)
		}
		if (this.switchDetailsPollInterval) {
			clearInterval(this.switchDetailsPollInterval)
		}

		// Poll device list every 10 minutes
		let deviceListPollBusy = false
		this.deviceListPollInterval = setInterval(async () => {
			if (deviceListPollBusy || this.isDestroyed) {
				return
			}
			deviceListPollBusy = true
			try {
				await this.refreshDeviceList()
			} catch (error) {
				const err = error as Error
				this.log('warn', `Device list polling error: ${err.message}`)
			} finally {
				deviceListPollBusy = false
			}
		}, 600000)

		// Poll switch details every 5 seconds (for PoE status)
		// A full sweep of all switches can take longer than the interval on a slow
		// controller, so skip a tick rather than stacking overlapping request storms.
		let switchDetailsPollBusy = false
		this.switchDetailsPollInterval = setInterval(async () => {
			if (switchDetailsPollBusy || this.isDestroyed) {
				return
			}
			switchDetailsPollBusy = true
			try {
				await this.refreshSwitchDetails()
			} catch (error) {
				const err = error as Error
				this.log('warn', `Switch details polling error: ${err.message}`)
				// Don't change status here - let it fail multiple times before reconnecting
			} finally {
				switchDetailsPollBusy = false
			}
		}, 5000)
	}

	/**
	 * Stop polling for device updates
	 */
	private stopPolling(): void {
		if (this.deviceListPollInterval) {
			clearInterval(this.deviceListPollInterval)
			this.deviceListPollInterval = undefined
		}
		if (this.switchDetailsPollInterval) {
			clearInterval(this.switchDetailsPollInterval)
			this.switchDetailsPollInterval = undefined
		}
	}

	/**
	 * Refresh device list from controller (full refresh on startup)
	 */
	async refreshDevices(): Promise<void> {
		await this.refreshDeviceList()
		await this.refreshSwitchDetails()
	}

	/**
	 * Refresh device list only (polled every 10 minutes)
	 */
	async refreshDeviceList(): Promise<void> {
		// Captured locally: destroy()/configUpdated() can clear this.client while the
		// request below is still in flight
		const client = this.client
		if (!client) {
			return
		}

		try {
			const devices = await client.getDevices()
			if (this.isDestroyed || this.client !== client) {
				return
			}

			// Update device cache
			this.deviceCache.clear()
			devices.forEach((device) => {
				this.deviceCache.set(device.mac, device)
			})

			this.log('debug', `Refreshed ${devices.length} devices`)

			// Update action and feedback definitions to refresh dropdown choices
			this.updateActions()
			this.updateFeedbacks()
		} catch (error) {
			const err = error as Error
			this.log('error', `Failed to refresh device list: ${err.message}`)
			throw error
		}
	}

	/**
	 * Refresh switch details for PoE status (polled every 5 seconds)
	 */
	async refreshSwitchDetails(): Promise<void> {
		// Captured locally: this sweep spans several seconds, and destroy()/configUpdated()
		// can clear this.client partway through
		const client = this.client
		if (!client) {
			return
		}

		try {
			// Get all switches from device cache
			const switches = this.getAllDevices().filter((d) => d.type === 'switch')

			// Refresh switch details for all switches
			for (const sw of switches) {
				if (this.isDestroyed || this.client !== client) {
					return
				}
				try {
					const details = await client.getSwitchDetails(sw.mac)
					this.switchDetailsCache.set(sw.mac, details)
				} catch (error) {
					this.log('warn', `Failed to get details for switch ${sw.mac}: ${(error as Error).message}`)
				}
			}

			if (this.isDestroyed || this.client !== client) {
				return
			}

			this.log('debug', `Refreshed PoE status for ${switches.length} switches`)

			// Update all feedbacks with new data
			this.checkFeedbacks()
		} catch (error) {
			const err = error as Error
			this.log('debug', `Failed to refresh switch details: ${err.message}`)
			// Don't throw - this is called frequently in polling
		}
	}

	/**
	 * Get a device from the cache
	 */
	getDevice(deviceMac: string): OmadaDevice | undefined {
		return this.deviceCache.get(deviceMac)
	}

	/**
	 * Get all cached devices
	 */
	getAllDevices(): OmadaDevice[] {
		return Array.from(this.deviceCache.values())
	}

	/**
	 * Get device choices for dropdowns (only switches with PoE capability)
	 */
	getDeviceChoices(): Array<{ id: string; label: string }> {
		const devices = this.getAllDevices()
		const switches = devices.filter((d) => d.type === 'switch')

		return switches.map((device) => ({
			id: device.mac,
			label: `${device.name || 'Unnamed'} (${device.mac})`,
		}))
	}

	/**
	 * Check if PoE is enabled on a specific port
	 * Uses switch details cache which includes portStatus.poe
	 */
	isPoeEnabled(deviceMac: string, portNumber: number): boolean {
		const switchDetails = this.switchDetailsCache.get(deviceMac)
		if (!switchDetails) {
			return false
		}

		const port = switchDetails.ports?.find((p: any) => p.port === portNumber)
		if (!port) {
			return false
		}

		// PoE status is in portStatus.poe (boolean) for OC200
		return port.portStatus?.poe === true
	}

	/**
	 * Toggle PoE on a port with optimistic update and delayed confirmation
	 * This provides instant feedback while waiting for hardware to catch up
	 */
	async togglePortPoe(deviceMac: string, portNumber: number, enablePoe: boolean): Promise<void> {
		if (!this.client) {
			throw new Error('Client not initialized')
		}

		try {
			// Send the toggle command
			await this.client.updatePortPoe(deviceMac, portNumber, enablePoe)

			// Optimistically update the cached state immediately
			const switchDetails = this.switchDetailsCache.get(deviceMac)
			if (switchDetails) {
				const port = switchDetails.ports?.find((p: any) => p.port === portNumber)
				if (port && port.portStatus) {
					port.portStatus.poe = enablePoe
					this.log('debug', `Optimistically updated port ${portNumber} PoE to ${enablePoe}`)
				}
			}

			// Update feedbacks immediately with the optimistic state
			this.checkFeedbacks()

			// Clear any existing confirmation timeout for this port
			const timeoutKey = `${deviceMac}:${portNumber}`
			const existingTimeout = this.confirmationTimeouts.get(timeoutKey)
			if (existingTimeout) {
				clearTimeout(existingTimeout)
			}

			// Schedule a confirmation refresh in 30 seconds to get actual hardware state
			// (Omada hardware can be slow, taking 8-12+ seconds to apply PoE changes)
			const confirmTimeout = setTimeout(async () => {
				this.log('debug', `Confirming PoE state for port ${portNumber}...`)
				const client = this.client
				if (!client || this.isDestroyed) {
					this.confirmationTimeouts.delete(timeoutKey)
					return
				}
				try {
					const details = await client.getSwitchDetails(deviceMac)
					this.switchDetailsCache.set(deviceMac, details)
					this.checkFeedbacks()
					this.log('debug', `Confirmed PoE state for port ${portNumber}`)
				} catch (error) {
					this.log('warn', `Failed to confirm PoE state: ${(error as Error).message}`)
				}
				this.confirmationTimeouts.delete(timeoutKey)
			}, 30000) // 30 second delay

			this.confirmationTimeouts.set(timeoutKey, confirmTimeout)
		} catch (error) {
			// If toggle failed, refresh immediately to get correct state
			this.log('error', `Failed to toggle PoE: ${(error as Error).message}`)
			await this.refreshDevices()
			throw error
		}
	}

	/**
	 * Clean up when module is destroyed
	 */
	async destroy(): Promise<void> {
		this.log('debug', 'Destroying module instance')
		this.isDestroyed = true

		// Stop polling
		this.stopPolling()

		// Clear reconnect timeout
		if (this.reconnectTimeout) {
			clearTimeout(this.reconnectTimeout)
			this.reconnectTimeout = undefined
		}

		// Clear all confirmation timeouts
		for (const timeout of this.confirmationTimeouts.values()) {
			clearTimeout(timeout)
		}
		this.confirmationTimeouts.clear()

		// Logout from controller. Not awaited - it is a best-effort courtesy call to
		// the controller and must not hold up Companion's destroy deadline.
		if (this.client) {
			void this.client.logout()
			this.client = undefined
		}
	}

	/**
	 * Handle configuration updates
	 *
	 * Like init(), this must return promptly - Companion applies the same RPC
	 * deadline here, and blocking on a slow controller would make saving the config
	 * fail exactly when the user is trying to correct a bad connection setting.
	 */
	async configUpdated(config: ModuleConfig): Promise<void> {
		this.config = config

		// Stop polling and clear reconnect
		this.stopPolling()
		if (this.reconnectTimeout) {
			clearTimeout(this.reconnectTimeout)
			this.reconnectTimeout = undefined
		}

		// Drop the old session without waiting on the network
		if (this.client) {
			void this.client.logout()
			this.client = undefined
		}

		// Clear stale state so feedbacks don't report the previous controller
		this.deviceCache.clear()
		this.switchDetailsCache.clear()

		// Re-initialize with new config (deliberately not awaited - see above)
		if (this.config.host && this.config.username && this.config.password) {
			this.updateStatus(InstanceStatus.Connecting)
			void this.initConnection()
		} else {
			this.updateStatus(InstanceStatus.BadConfig, 'Missing configuration')
		}
	}

	/**
	 * Return config fields for display in module settings
	 */
	getConfigFields() {
		return GetConfigFields()
	}

	/**
	 * Update available actions
	 */
	updateActions(): void {
		UpdateActions(this)
	}

	/**
	 * Update available feedbacks
	 */
	updateFeedbacks(): void {
		UpdateFeedbacks(this)
	}
}

// Run the module
runEntrypoint(OmadaModuleInstance, [])
