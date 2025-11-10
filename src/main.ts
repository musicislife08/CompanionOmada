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
	private pollInterval?: NodeJS.Timeout
	private deviceCache: Map<string, OmadaDevice> = new Map()
	private switchDetailsCache: Map<string, any> = new Map() // Cache switch details for PoE status
	private reconnectTimeout?: NodeJS.Timeout

	/**
	 * Initialize the module instance
	 */
	async init(config: ModuleConfig): Promise<void> {
		this.config = config
		this.updateStatus(InstanceStatus.Connecting)

		// Initialize actions and feedbacks
		this.updateActions()
		this.updateFeedbacks()

		// Connect to Omada controller if configured
		if (this.config.host && this.config.username && this.config.password) {
			await this.initConnection()
		} else {
			this.updateStatus(InstanceStatus.BadConfig, 'Missing configuration')
			this.log('warn', 'Module not configured - please configure controller connection')
		}
	}

	/**
	 * Initialize connection to Omada controller
	 */
	async initConnection(): Promise<void> {
		try {
			// Create client instance
			this.client = new OmadaClient(this.config, (level, message) => {
				this.log(level, message)
			})

			// Attempt login
			await this.client.login()

			// Fetch initial device list
			await this.refreshDevices()

			// Update status to OK
			this.updateStatus(InstanceStatus.Ok)
			this.log('info', 'Connected to Omada controller')

			// Start polling for device updates
			this.startPolling()
		} catch (error) {
			const err = error as Error
			this.log('error', `Failed to connect: ${err.message}`)
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

		this.reconnectTimeout = setTimeout(() => {
			this.log('info', 'Attempting to reconnect...')
			this.initConnection()
		}, 30000) // Retry every 30 seconds
	}

	/**
	 * Start polling for device updates (for feedbacks)
	 */
	private startPolling(): void {
		// Clear any existing interval
		if (this.pollInterval) {
			clearInterval(this.pollInterval)
		}

		// Poll every 5 seconds
		this.pollInterval = setInterval(async () => {
			try {
				await this.refreshDevices()
			} catch (error) {
				const err = error as Error
				this.log('warn', `Polling error: ${err.message}`)
				// Don't change status here - let it fail multiple times before reconnecting
			}
		}, 5000)
	}

	/**
	 * Stop polling for device updates
	 */
	private stopPolling(): void {
		if (this.pollInterval) {
			clearInterval(this.pollInterval)
			this.pollInterval = undefined
		}
	}

	/**
	 * Refresh device list from controller
	 */
	async refreshDevices(): Promise<void> {
		if (!this.client) {
			return
		}

		try {
			const devices = await this.client.getDevices()

			// Update device cache
			this.deviceCache.clear()
			devices.forEach((device) => {
				this.deviceCache.set(device.mac, device)
			})

			this.log('debug', `Refreshed ${devices.length} devices`)

			// Also refresh switch details for switches (to get PoE port status)
			this.switchDetailsCache.clear()
			const switches = devices.filter((d) => d.type === 'switch')

			for (const sw of switches) {
				try {
					const details = await this.client.getSwitchDetails(sw.mac)
					this.switchDetailsCache.set(sw.mac, details)
				} catch (error) {
					this.log('warn', `Failed to get details for switch ${sw.mac}: ${(error as Error).message}`)
				}
			}

			// Update all feedbacks with new data
			this.checkFeedbacks()
		} catch (error) {
			const err = error as Error
			this.log('error', `Failed to refresh devices: ${err.message}`)
			throw error
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
	 * Clean up when module is destroyed
	 */
	async destroy(): Promise<void> {
		this.log('debug', 'Destroying module instance')

		// Stop polling
		this.stopPolling()

		// Clear reconnect timeout
		if (this.reconnectTimeout) {
			clearTimeout(this.reconnectTimeout)
		}

		// Logout from controller
		if (this.client) {
			await this.client.logout()
		}
	}

	/**
	 * Handle configuration updates
	 */
	async configUpdated(config: ModuleConfig): Promise<void> {
		this.config = config

		// Stop polling and clear reconnect
		this.stopPolling()
		if (this.reconnectTimeout) {
			clearTimeout(this.reconnectTimeout)
		}

		// Logout from old connection
		if (this.client) {
			await this.client.logout()
		}

		// Re-initialize with new config
		await this.initConnection()
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
