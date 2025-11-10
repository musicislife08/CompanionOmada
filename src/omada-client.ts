import axios, { AxiosInstance, AxiosError } from 'axios'
import https from 'https'
import type { LogLevel } from '@companion-module/base'
import { ModuleConfig } from './config.js'

/**
 * Represents a device port with PoE information
 */
export interface DevicePort {
	port: number
	name: string
	poe?: boolean // Whether PoE is enabled on this port
	poe_mode?: string // "enabled" or "disabled"
	poe_power?: number // Current power draw in watts
}

/**
 * Represents a network device (switch or gateway) in Omada
 */
export interface OmadaDevice {
	mac: string
	type: string // "switch" or "gateway"
	name: string
	model?: string
	poeSupport?: boolean
	ports: DevicePort[]
}

/**
 * Client for interacting with TP-Link Omada controller API
 */
export class OmadaClient {
	private baseUrl: string
	private controllerId: string = ''
	private token: string = ''
	private siteId: string = ''
	private http: AxiosInstance
	private username: string
	private password: string
	private logCallback?: (level: LogLevel, message: string) => void
	private cookies: string[] = []

	constructor(config: ModuleConfig, logCallback?: (level: LogLevel, message: string) => void) {
		this.baseUrl = `https://${config.host}:${config.port}`
		this.siteId = config.site
		this.username = config.username
		this.password = config.password
		this.logCallback = logCallback

		// Create HTTP client with optional SSL verification
		this.http = axios.create({
			baseURL: this.baseUrl,
			httpsAgent: new https.Agent({
				rejectUnauthorized: config.verifySsl,
			}),
			timeout: 10000,
			headers: {
				'Content-Type': 'application/json',
			},
		})
	}

	/**
	 * Log a message through the callback if available
	 */
	private log(level: LogLevel, message: string): void {
		if (this.logCallback) {
			this.logCallback(level, message)
		}
	}

	/**
	 * Login to the Omada controller and obtain authentication token
	 */
	async login(): Promise<void> {
		try {
			// Step 1: Get controller ID
			this.log('debug', 'Fetching controller info...')
			const infoResponse = await this.http.get('/api/info')

			if (!infoResponse.data?.result?.omadacId) {
				throw new Error('Failed to get controller ID from response')
			}

			this.controllerId = infoResponse.data.result.omadacId
			this.log('debug', `Controller ID: ${this.controllerId}`)

			// Step 2: Login with credentials
			this.log('debug', 'Attempting login...')
			const loginResponse = await this.http.post(`/${this.controllerId}/api/v2/login`, {
				username: this.username,
				password: this.password,
			})

			if (loginResponse.data?.errorCode !== 0) {
				throw new Error(loginResponse.data?.msg || 'Login failed')
			}

			this.token = loginResponse.data.result.token
			this.log('info', 'Successfully logged in to Omada controller')

			// Extract cookies from login response
			const setCookieHeader = loginResponse.headers['set-cookie']
			if (setCookieHeader) {
				this.cookies = setCookieHeader
				this.log('debug', `Received ${this.cookies.length} cookies from login`)
			}

			// Set token and cookies for all future requests
			this.http.defaults.headers.common['Csrf-Token'] = this.token
			if (this.cookies.length > 0) {
				this.http.defaults.headers.common['Cookie'] = this.cookies.map(c => c.split(';')[0]).join('; ')
			}

			// Resolve site name to site key (required for OC200 hardware controllers)
			await this.resolveSiteKey()
		} catch (error) {
			const err = error as AxiosError
			this.log('error', `Login failed: ${err.message}`)
			if (err.response?.status === 401) {
				throw new Error('Invalid username or password')
			} else if (err.code === 'ECONNREFUSED') {
				throw new Error('Cannot connect to controller - check IP and port')
			} else if (err.code === 'CERT_HAS_EXPIRED' || err.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
				throw new Error('SSL certificate error - try disabling SSL verification')
			}
			throw error
		}
	}

	/**
	 * Get user info and resolve site name to site key
	 * OC200 controllers require using the site KEY (hex ID) instead of the site name
	 * This method updates this.siteId with the resolved site key
	 */
	async resolveSiteKey(): Promise<void> {
		try {
			this.log('debug', `Resolving site key for: "${this.siteId}"`)
			const response = await this.http.get(`/${this.controllerId}/api/v2/users/current`)

			this.log('debug', `User info response status: ${response.status}`)
			this.log('debug', `User info errorCode: ${response.data?.errorCode}`)

			if (response.data?.errorCode !== 0) {
				throw new Error(response.data?.msg || 'Failed to get user info')
			}

			const userSites = response.data.result.privilege.sites || []
			this.log('debug', `Found ${userSites.length} sites in user privileges`)
			userSites.forEach((s: any) => {
				this.log('debug', `  Site: "${s.name}" -> Key: "${s.key}"`)
			})

			// Find the matching site by name
			const matchingSite = userSites.find((s: any) => s.name === this.siteId)
			if (matchingSite) {
				const siteKey = matchingSite.key
				this.log('info', `Resolved site "${this.siteId}" to key: ${siteKey}`)
				this.siteId = siteKey
				this.log('debug', `this.siteId is now: ${this.siteId}`)
			} else {
				// If no match found, log available sites and keep siteId as-is
				// (might already be a site key, or using software controller)
				const availableSites = userSites.map((s: any) => s.name).join(', ')
				this.log('warn', `Site "${this.siteId}" not found in user privileges. Available: ${availableSites}`)
				this.log('warn', `Using "${this.siteId}" as-is (may already be a site key)`)
			}
		} catch (error) {
			const err = error as AxiosError
			this.log('error', `resolveSiteKey error: ${err.message}`)
			if (err.response) {
				this.log('error', `Response status: ${err.response.status}`)
				this.log('error', `Response data type: ${typeof err.response.data}`)
			}
			// Keep siteId as-is if we can't get user info
		}
	}

	/**
	 * Logout from the Omada controller
	 */
	async logout(): Promise<void> {
		try {
			if (this.token && this.controllerId) {
				await this.http.post(`/${this.controllerId}/api/v2/logout`)
				this.log('debug', 'Logged out from Omada controller')
			}
		} catch (error) {
			// Ignore logout errors - connection may already be closed
			this.log('debug', 'Logout error (ignored)')
		} finally {
			this.token = ''
			this.cookies = []
			delete this.http.defaults.headers.common['Csrf-Token']
			delete this.http.defaults.headers.common['Cookie']
		}
	}

	/**
	 * Get all devices from the Omada controller
	 */
	async getDevices(): Promise<OmadaDevice[]> {
		try {
			this.log('debug', `Getting devices from site: ${this.siteId}`)
			this.log('debug', `Devices URL: /${this.controllerId}/api/v2/sites/${this.siteId}/devices`)

			const response = await this.http.get(
				`/${this.controllerId}/api/v2/sites/${this.siteId}/devices`
			)

			this.log('debug', `API Response status: ${response.status}`)
			this.log('debug', `API Response content-type: ${response.headers['content-type']}`)

			// Check if response has errorCode field (some API versions may not)
			if (response.data?.errorCode !== undefined && response.data?.errorCode !== 0) {
				throw new Error(response.data?.msg || 'Failed to get devices')
			}

			// Handle different API response formats:
			// 1. Direct array: response.data = [...]
			// 2. Result as array: response.data = { errorCode: 0, msg: "Success.", result: [...] } (OC200)
			// 3. Wrapped in result.data: response.data = { result: { data: [...] } }
			// 4. Wrapped in data: response.data = { data: [...] }
			let devices: OmadaDevice[] = []

			if (Array.isArray(response.data)) {
				// Format 1: Direct array
				devices = response.data
				this.log('debug', `Response is direct array with ${devices.length} items`)
				if (devices.length > 0) {
					this.log('debug', `First device keys: ${Object.keys(devices[0] || {}).slice(0, 10).join(', ')}`)
				}
			} else if (Array.isArray(response.data?.result)) {
				// Format 2: Result is directly an array (OC200 hardware controllers)
				devices = response.data.result
				this.log('debug', `Response has result as array with ${devices.length} items`)
			} else if (response.data?.result?.data) {
				// Format 3: Wrapped in result.data
				devices = response.data.result.data
				this.log('debug', `Response is wrapped in result.data with ${devices.length} items`)
			} else if (response.data?.data) {
				// Format 4: Wrapped in data
				devices = response.data.data
				this.log('debug', `Response is wrapped in data with ${devices.length} items`)
			} else {
				this.log('debug', `Response type: ${typeof response.data}, isArray: ${Array.isArray(response.data)}`)
				this.log('debug', `Response data type: ${response.data?.constructor?.name}`)
				if (typeof response.data === 'string') {
					this.log('debug', `Response is string, first 200 chars: ${response.data.substring(0, 200)}`)
				}
			}

			this.log('debug', `Retrieved ${devices.length} devices`)

			return devices
		} catch (error) {
			const err = error as AxiosError
			if (err.response?.status === 401) {
				this.log('warn', 'Session expired, re-authenticating...')
				await this.login()
				return this.getDevices() // Retry after re-login
			}
			this.log('error', `getDevices error: ${err.message}, status: ${err.response?.status}`)
			throw error
		}
	}

	/**
	 * Get detailed information about a specific device
	 */
	async getDevice(deviceMac: string): Promise<OmadaDevice | null> {
		const devices = await this.getDevices()
		return devices.find((d) => d.mac === deviceMac) || null
	}

	/**
	 * Get the PoE status of a specific port
	 * OC200 stores PoE status in portStatus.poe (boolean)
	 */
	async getPortPoeStatus(deviceMac: string, portNumber: number): Promise<boolean> {
		try {
			// Get switch details which includes port status
			const switchData = await this.getSwitchDetails(deviceMac)
			const port = switchData.ports?.find((p: any) => p.port === portNumber)

			if (!port) {
				throw new Error(`Port ${portNumber} not found on device ${deviceMac}`)
			}

			// PoE status is in portStatus.poe (boolean) for OC200
			return port.portStatus?.poe === true
		} catch (error) {
			this.log('error', `Failed to get PoE status for port ${portNumber}: ${(error as Error).message}`)
			throw error
		}
	}

	/**
	 * Get switch details including port configuration
	 */
	async getSwitchDetails(deviceMac: string): Promise<any> {
		try {
			const response = await this.http.get(
				`/${this.controllerId}/api/v2/sites/${this.siteId}/switches/${deviceMac}`
			)

			if (response.data?.errorCode !== 0) {
				throw new Error(response.data?.msg || 'Failed to get switch details')
			}

			return response.data.result
		} catch (error) {
			const err = error as AxiosError
			this.log('error', `getSwitchDetails error: ${err.message}`)
			throw error
		}
	}

	/**
	 * Get port profile configuration
	 */
	async getPortProfile(profileId: string): Promise<any> {
		try {
			const response = await this.http.get(
				`/${this.controllerId}/api/v2/sites/${this.siteId}/setting/lan/profiles/${profileId}`
			)

			if (response.data?.errorCode !== 0) {
				throw new Error(response.data?.msg || 'Failed to get port profile')
			}

			return response.data.result
		} catch (error) {
			const err = error as AxiosError
			this.log('error', `getPortProfile error: ${err.message}`)
			throw error
		}
	}

	/**
	 * Enable or disable PoE on a switch port
	 * OC200 requires profileOverrideEnable and full port config
	 * We fetch the profile settings and only override the PoE field
	 */
	async updateSwitchPortPoe(deviceMac: string, portNumber: number, enablePoe: boolean): Promise<void> {
		try {
			this.log('debug', `Setting PoE ${enablePoe ? 'ON' : 'OFF'} for port ${portNumber} on ${deviceMac}`)

			// Get current port configuration
			const switchData = await this.getSwitchDetails(deviceMac)
			const port = switchData.ports?.find((p: any) => p.port === portNumber)

			if (!port) {
				throw new Error(`Port ${portNumber} not found on switch ${deviceMac}`)
			}

			// Get the port profile to use its settings (except PoE which we're overriding)
			const profile = await this.getPortProfile(port.profileId)

			// Build port config using profile settings but overriding PoE
			const portConfig = {
				name: port.name,
				profileId: port.profileId,
				profileOverrideEnable: true, // Enable overrides
				dhcpL2RelaySettings: profile.dhcpL2RelaySettings || { enable: false },
				operation: profile.operation || 'switching',
				linkSpeed: profile.linkSpeed ?? 0,
				duplex: profile.duplex ?? 0,
				topoNotifyEnable: profile.topoNotifyEnable ?? false,
				poe: enablePoe ? 1 : 0, // 0 = OFF, 1 = ON (this is the override)
				dot1x: profile.dot1x ?? 2,
				bandWidthCtrlType: profile.bandWidthCtrlType ?? 0,
				loopbackDetectEnable: profile.loopbackDetectEnable ?? false,
				spanningTreeEnable: profile.spanningTreeEnable ?? false,
				loopbackDetectVlanBasedEnable: profile.loopbackDetectVlanBasedEnable ?? false,
				portIsolationEnable: profile.portIsolationEnable ?? false,
				flowControlEnable: profile.flowControlEnable ?? false,
				eeeEnable: profile.eeeEnable ?? false,
				lldpMedEnable: profile.lldpMedEnable ?? true,
			}

			this.log('debug', `Using profile "${profile.name || 'unknown'}" settings with PoE override`)

			const response = await this.http.patch(
				`/${this.controllerId}/api/v2/sites/${this.siteId}/switches/${deviceMac}/ports/${portNumber}`,
				portConfig
			)

			if (response.data?.errorCode !== 0) {
				throw new Error(response.data?.msg || 'Failed to update port PoE')
			}

			this.log('info', `PoE ${enablePoe ? 'enabled' : 'disabled'} on port ${portNumber}`)
		} catch (error) {
			const err = error as AxiosError
			if (err.response?.status === 401) {
				this.log('warn', 'Session expired, re-authenticating...')
				await this.login()
				return this.updateSwitchPortPoe(deviceMac, portNumber, enablePoe) // Retry
			}
			throw error
		}
	}

	/**
	 * Enable or disable PoE on a gateway port
	 */
	async updateGatewayPortPoe(deviceMac: string, portNumber: number, enablePoe: boolean): Promise<void> {
		try {
			this.log('debug', `Setting PoE ${enablePoe ? 'ON' : 'OFF'} for gateway port ${portNumber} on ${deviceMac}`)

			const response = await this.http.patch(
				`/${this.controllerId}/api/v2/sites/${this.siteId}/gateways/${deviceMac}/ports/${portNumber}`,
				{
					enable_poe: enablePoe,
				}
			)

			if (response.data?.errorCode !== 0) {
				throw new Error(response.data?.msg || 'Failed to update gateway port PoE')
			}

			this.log('info', `PoE ${enablePoe ? 'enabled' : 'disabled'} on gateway port ${portNumber}`)
		} catch (error) {
			const err = error as AxiosError
			if (err.response?.status === 401) {
				this.log('warn', 'Session expired, re-authenticating...')
				await this.login()
				return this.updateGatewayPortPoe(deviceMac, portNumber, enablePoe) // Retry
			}
			throw error
		}
	}

	/**
	 * Enable or disable PoE on a port (automatically detects device type)
	 */
	async updatePortPoe(deviceMac: string, portNumber: number, enablePoe: boolean): Promise<void> {
		const device = await this.getDevice(deviceMac)
		if (!device) {
			throw new Error(`Device ${deviceMac} not found`)
		}

		if (device.type === 'gateway') {
			await this.updateGatewayPortPoe(deviceMac, portNumber, enablePoe)
		} else {
			// Default to switch
			await this.updateSwitchPortPoe(deviceMac, portNumber, enablePoe)
		}
	}
}
