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

			// Set token for all future requests
			this.http.defaults.headers.common['Csrf-Token'] = this.token
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
			delete this.http.defaults.headers.common['Csrf-Token']
		}
	}

	/**
	 * Get all devices from the Omada controller
	 */
	async getDevices(): Promise<OmadaDevice[]> {
		try {
			const response = await this.http.get(
				`/${this.controllerId}/api/v2/sites/${this.siteId}/devices`
			)

			if (response.data?.errorCode !== 0) {
				throw new Error(response.data?.msg || 'Failed to get devices')
			}

			const devices: OmadaDevice[] = response.data.result.data || []
			this.log('debug', `Retrieved ${devices.length} devices`)

			return devices
		} catch (error) {
			const err = error as AxiosError
			if (err.response?.status === 401) {
				this.log('warn', 'Session expired, re-authenticating...')
				await this.login()
				return this.getDevices() // Retry after re-login
			}
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
	 */
	async getPortPoeStatus(deviceMac: string, portNumber: number): Promise<boolean> {
		const device = await this.getDevice(deviceMac)
		if (!device) {
			throw new Error(`Device ${deviceMac} not found`)
		}

		const port = device.ports.find((p) => p.port === portNumber)
		if (!port) {
			throw new Error(`Port ${portNumber} not found on device ${deviceMac}`)
		}

		// Check if PoE is enabled - can be indicated by poe field or poe_mode
		return port.poe === true || port.poe_mode === 'enabled'
	}

	/**
	 * Enable or disable PoE on a switch port
	 */
	async updateSwitchPortPoe(deviceMac: string, portNumber: number, enablePoe: boolean): Promise<void> {
		try {
			this.log('debug', `Setting PoE ${enablePoe ? 'ON' : 'OFF'} for port ${portNumber} on ${deviceMac}`)

			const response = await this.http.patch(
				`/${this.controllerId}/api/v2/sites/${this.siteId}/switches/${deviceMac}/ports/${portNumber}`,
				{
					overrides: {
						enable_poe: enablePoe,
					},
				}
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
