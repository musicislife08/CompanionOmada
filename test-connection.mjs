#!/usr/bin/env node

/**
 * Test script to debug Omada API connection
 * Run with: node test-connection.mjs
 *
 * Create a .env file with your credentials (see .env.example)
 * or enter them interactively when prompted.
 */

import axios from 'axios'
import https from 'https'
import readline from 'readline'
import dotenv from 'dotenv'

// Load .env file if it exists
dotenv.config()

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout
})

function question(prompt) {
	return new Promise((resolve) => {
		rl.question(prompt, resolve)
	})
}

async function testConnection() {
	console.log('=== Omada API Connection Test ===\n')

	// Use environment variables if available, otherwise prompt
	let host = process.env.OMADA_HOST
	let port = process.env.OMADA_PORT || '8043'
	let username = process.env.OMADA_USERNAME
	let password = process.env.OMADA_PASSWORD
	let site = process.env.OMADA_SITE || 'Default'

	if (!host || !username || !password) {
		console.log('No .env file found or incomplete. Enter connection details:\n')
		host = host || await question('Controller IP: ')
		port = await question(`Controller Port [${port}]: `) || port
		username = username || await question('Username: ')
		password = password || await question('Password: ')
		site = await question(`Site Name [${site}]: `) || site
	} else {
		console.log(`Using credentials from .env file`)
		console.log(`Host: ${host}:${port}`)
		console.log(`Site: ${site}\n`)
	}

	rl.close()

	console.log('\n--- Connecting to Omada Controller ---')

	const baseUrl = `https://${host}:${port}`

	// Create HTTP client
	const http = axios.create({
		baseURL: baseUrl,
		httpsAgent: new https.Agent({
			rejectUnauthorized: false // Accept self-signed certs
		}),
		timeout: 10000,
		headers: {
			'Content-Type': 'application/json',
		},
	})

	let cookies = []

	try {
		// Step 1: Get controller ID
		console.log('\n1. Fetching controller info...')
		const infoResponse = await http.get('/api/info')
		const controllerId = infoResponse.data.result.omadacId
		console.log(`   ✓ Controller ID: ${controllerId}`)
		console.log(`   Controller type: ${infoResponse.data.result.controllerVer || 'unknown'}`)
		console.log(`   API version: ${infoResponse.data.result.apiVer || 'unknown'}`)

		// Step 2: Login
		console.log('\n2. Logging in...')
		const loginResponse = await http.post(`/${controllerId}/api/v2/login`, {
			username,
			password
		})

		if (loginResponse.data?.errorCode !== 0) {
			throw new Error(loginResponse.data?.msg || 'Login failed')
		}

		const token = loginResponse.data.result.token
		console.log(`   ✓ Logged in successfully`)
		console.log(`   Token: ${token.substring(0, 20)}...`)

		// Extract cookies from login response
		const setCookieHeader = loginResponse.headers['set-cookie']
		if (setCookieHeader) {
			cookies = setCookieHeader
			console.log(`   Cookies received: ${cookies.length}`)
			cookies.forEach(c => console.log(`     - ${c.split(';')[0]}`))
		}

		// Set token and cookies for future requests
		http.defaults.headers.common['Csrf-Token'] = token
		if (cookies.length > 0) {
			http.defaults.headers.common['Cookie'] = cookies.map(c => c.split(';')[0]).join('; ')
		}

		// Step 3: Get user info to find site key
		console.log('\n3. Getting user info to find site key...')
		const userInfoResponse = await http.get(`/${controllerId}/api/v2/users/current`)

		if (userInfoResponse.data?.errorCode === 0) {
			const userSites = userInfoResponse.data.result.privilege.sites
			console.log(`   Found ${userSites.length} sites in user privileges:`)
			userSites.forEach(s => {
				console.log(`     - Name: "${s.name}", Key: "${s.key}"`)
			})

			// Find the matching site
			const matchingSite = userSites.find(s => s.name === site)
			if (matchingSite) {
				const siteKey = matchingSite.key
				console.log(`   ✓ Using site key for "${site}": ${siteKey}`)
				site = siteKey
			} else {
				console.log(`   ⚠️  Site "${site}" not found in user privileges`)
				console.log(`   Available sites: ${userSites.map(s => s.name).join(', ')}`)
			}
		}

		// Step 4: Get devices
		console.log(`\n4. Getting devices from site key: ${site}`)
		const devicesUrl = `/${controllerId}/api/v2/sites/${site}/devices`
		console.log(`   URL: ${devicesUrl}`)

		const devicesResponse = await http.get(devicesUrl)

		console.log('\n--- RESPONSE ANALYSIS ---')
		console.log(`Status: ${devicesResponse.status}`)
		console.log(`Content-Type: ${devicesResponse.headers['content-type']}`)
		console.log(`\nResponse type: ${typeof devicesResponse.data}`)
		console.log(`Is Array: ${Array.isArray(devicesResponse.data)}`)
		console.log(`Constructor: ${devicesResponse.data?.constructor?.name}`)

		// Check if we got HTML instead of JSON
		if (typeof devicesResponse.data === 'string' && devicesResponse.data.includes('<!DOCTYPE')) {
			console.log('\n⚠️  WARNING: Received HTML instead of JSON!')
			console.log('This usually means:')
			console.log('  - Authentication token not accepted')
			console.log('  - Being redirected to login page')
			console.log('  - Wrong API endpoint')
			return
		}

		if (devicesResponse.data) {
			const keys = Object.keys(devicesResponse.data)
			console.log(`\nNumber of keys: ${keys.length}`)
			console.log(`First 20 keys: ${keys.slice(0, 20).join(', ')}`)
			console.log(`Last 20 keys: ${keys.slice(-20).join(', ')}`)
		}

		// Try to parse as different formats
		console.log('\n--- TRYING DIFFERENT FORMATS ---')

		if (Array.isArray(devicesResponse.data)) {
			console.log(`✓ Direct array detected: ${devicesResponse.data.length} items`)
			if (devicesResponse.data.length > 0) {
				console.log(`\nFirst item type: ${typeof devicesResponse.data[0]}`)
				console.log(`First item keys: ${Object.keys(devicesResponse.data[0]).join(', ')}`)
				console.log(`\nFirst device sample:`)
				console.log(JSON.stringify(devicesResponse.data[0], null, 2))
			}
		} else if (devicesResponse.data?.result?.data) {
			console.log(`✓ Wrapped in result.data: ${devicesResponse.data.result.data.length} items`)
		} else if (devicesResponse.data?.data) {
			console.log(`✓ Wrapped in data: ${devicesResponse.data.data.length} items`)
		} else {
			console.log('✗ Unknown format')
			console.log('\nFull response structure:')
			console.log(JSON.stringify(devicesResponse.data, null, 2).substring(0, 2000))
		}

		// Step 5: Find specific device
		console.log('\n5. Looking for specific device...')
		const targetMac = '5C-62-8B-AE-F1-F7'
		const targetMacNoDashes = targetMac.replace(/-/g, '')
		const targetMacColons = targetMac.replace(/-/g, ':')
		const targetPort = 16

		let devices = []
		if (Array.isArray(devicesResponse.data)) {
			devices = devicesResponse.data
		} else if (Array.isArray(devicesResponse.data?.result)) {
			devices = devicesResponse.data.result
		} else if (devicesResponse.data?.result?.data) {
			devices = devicesResponse.data.result.data
		} else if (devicesResponse.data?.data) {
			devices = devicesResponse.data.data
		}

		console.log(`   Searching ${devices.length} devices for MAC: ${targetMac}`)

		const targetDevice = devices.find(d => d.mac === targetMac)
		if (targetDevice) {
			console.log(`   ✓ Found device: ${targetDevice.name}`)
			console.log(`     Type: ${targetDevice.type}`)
			console.log(`     Model: ${targetDevice.model || 'unknown'}`)
			console.log(`     MAC: ${targetDevice.mac}`)

			// Check if device has port info
			if (targetDevice.ports) {
				console.log(`     Ports: ${targetDevice.ports.length}`)
				const port = targetDevice.ports.find(p => p.port === targetPort)
				if (port) {
					console.log(`     Port ${targetPort} PoE: ${port.poe || port.poe_mode || 'unknown'}`)
				}
			} else {
				console.log(`     ⚠️  No port information in device object`)
			}

			// Step 6: Get switch details with ports
			console.log(`\n6. Getting switch details with port information...`)

			try {
				const switchUrl = `/${controllerId}/api/v2/sites/${site}/switches/${targetMac}`
				console.log(`   URL: ${switchUrl}`)

				const switchResponse = await http.get(switchUrl)

				if (switchResponse.data?.errorCode === 0) {
					console.log(`   ✓ Got switch details`)
					const switchData = switchResponse.data.result

					if (switchData.ports) {
						console.log(`   Found ${switchData.ports.length} ports`)
						const port = switchData.ports.find(p => p.port === targetPort)
						if (port) {
							console.log(`   Port ${targetPort} details:`)
							console.log(`     Full port object:`)
							console.log(JSON.stringify(port, null, 2))

							// Step 7: Try to toggle PoE on port 16
							console.log(`\n7. Trying PoE toggle with different payload formats...`)

							const poeUrl = `/${controllerId}/api/v2/sites/${site}/switches/${targetMac}/ports/${targetPort}`
							const poeUrlById = `/${controllerId}/api/v2/sites/${site}/switches/${targetMac}/ports/${port.id}`
							console.log(`   URL (by port number): ${poeUrl}`)
							console.log(`   URL (by port ID): ${poeUrlById}`)

							// Try format 1: wrapped in overrides
							try {
								console.log(`\n   Attempt 1: { overrides: { enable_poe: true } }`)
								const poeResponse = await http.patch(poeUrl, {
									overrides: {
										enable_poe: true
									}
								})
								console.log(`   Result: errorCode=${poeResponse.data?.errorCode}, msg="${poeResponse.data?.msg}"`)
								if (poeResponse.data?.errorCode === 0) {
									console.log(`   ✓ SUCCESS with overrides format!`)
								}
							} catch (e) {
								console.log(`   Failed: ${e.response?.data?.msg || e.message}`)
							}

							// Try format 2: direct enable_poe
							try {
								console.log(`\n   Attempt 2: { enable_poe: true }`)
								const poeResponse = await http.patch(poeUrl, {
									enable_poe: true
								})
								console.log(`   Result: errorCode=${poeResponse.data?.errorCode}, msg="${poeResponse.data?.msg}"`)
								if (poeResponse.data?.errorCode === 0) {
									console.log(`   ✓ SUCCESS with direct format!`)
								}
							} catch (e) {
								console.log(`   Failed: ${e.response?.data?.msg || e.message}`)
							}

							// Try format 3: poe object
							try {
								console.log(`\n   Attempt 3: { poe: { enable: true } }`)
								const poeResponse = await http.patch(poeUrl, {
									poe: {
										enable: true
									}
								})
								console.log(`   Result: errorCode=${poeResponse.data?.errorCode}, msg="${poeResponse.data?.msg}"`)
								if (poeResponse.data?.errorCode === 0) {
									console.log(`   ✓ SUCCESS with poe object format!`)
								}
							} catch (e) {
								console.log(`   Failed: ${e.response?.data?.msg || e.message}`)
							}

							// Try format 4: PUT with full port config
							try {
								console.log(`\n   Attempt 4: PUT with full port config + overrides`)
								const poeResponse = await http.put(poeUrl, {
									...port,
									overrides: {
										enable_poe: false  // Turn OFF to test
									}
								})
								console.log(`   Result: errorCode=${poeResponse.data?.errorCode}, msg="${poeResponse.data?.msg}"`)
								if (poeResponse.data?.errorCode === 0) {
									console.log(`   ✓ SUCCESS with PUT + full config!`)
								}
							} catch (e) {
								console.log(`   Failed: ${e.response?.data?.msg || e.message}`)
							}

							// Try format 5: Just the profile ID
							try {
								console.log(`\n   Attempt 5: PATCH with profileId + disable false`)
								const poeResponse = await http.patch(poeUrl, {
									profileId: port.profileId,
									disable: false,
									overrides: {
										enable_poe: false
									}
								})
								console.log(`   Result: errorCode=${poeResponse.data?.errorCode}, msg="${poeResponse.data?.msg}"`)
								if (poeResponse.data?.errorCode === 0) {
									console.log(`   ✓ SUCCESS with profileId format!`)
								}
							} catch (e) {
								console.log(`   Failed: ${e.response?.data?.msg || e.message}`)
							}

							// Try format 6: Use port ID instead of port number in URL
							try {
								console.log(`\n   Attempt 6: Use port ID in URL with overrides`)
								const poeResponse = await http.patch(poeUrlById, {
									overrides: {
										enable_poe: false
									}
								})
								console.log(`   Result: errorCode=${poeResponse.data?.errorCode}, msg="${poeResponse.data?.msg}"`)
								if (poeResponse.data?.errorCode === 0) {
									console.log(`   ✓ SUCCESS with port ID in URL!`)
								}
							} catch (e) {
								console.log(`   Failed: ${e.response?.data?.msg || e.message}`)
							}

							// Try format 7: POST to /poe endpoint
							try {
								console.log(`\n   Attempt 7: POST to separate /poe endpoint`)
								const poeResponse = await http.post(`/${controllerId}/api/v2/sites/${site}/switches/${targetMac}/ports/${targetPort}/poe`, {
									enable: false
								})
								console.log(`   Result: errorCode=${poeResponse.data?.errorCode}, msg="${poeResponse.data?.msg}"`)
								if (poeResponse.data?.errorCode === 0) {
									console.log(`   ✓ SUCCESS with /poe POST endpoint!`)
								}
							} catch (e) {
								console.log(`   Failed: ${e.response?.data?.msg || e.message}`)
							}

							// Try format 8: PATCH with just port number and overrides at root
							try {
								console.log(`\n   Attempt 8: PATCH with port + overrides at root`)
								const poeResponse = await http.patch(poeUrl, {
									port: targetPort,
									overrides: {
										enable_poe: false
									}
								})
								console.log(`   Result: errorCode=${poeResponse.data?.errorCode}, msg="${poeResponse.data?.msg}"`)
								if (poeResponse.data?.errorCode === 0) {
									console.log(`   ✓ SUCCESS!`)
								}
							} catch (e) {
								console.log(`   Failed: ${e.response?.data?.msg || e.message}`)
							}

							// Try format 9: PATCH with profileId set to empty
							try {
								console.log(`\n   Attempt 9: PATCH with profileId="" + overrides`)
								const poeResponse = await http.patch(poeUrl, {
									profileId: "",
									overrides: {
										enable_poe: false
									}
								})
								console.log(`   Result: errorCode=${poeResponse.data?.errorCode}, msg="${poeResponse.data?.msg}"`)
								if (poeResponse.data?.errorCode === 0) {
									console.log(`   ✓ SUCCESS with empty profileId!`)
								}
							} catch (e) {
								console.log(`   Failed: ${e.response?.data?.msg || e.message}`)
							}

							// Try format 10: Just send the whole port object with enable_poe added
							try {
								console.log(`\n   Attempt 10: PUT with full port + enable_poe in overrides`)
								const modifiedPort = {
									...port,
									overrides: {
										...port.overrides,
										enable_poe: false
									}
								}
								delete modifiedPort.id
								delete modifiedPort.portStatus
								delete modifiedPort.portCap

								const poeResponse = await http.patch(poeUrl, modifiedPort)
								console.log(`   Result: errorCode=${poeResponse.data?.errorCode}, msg="${poeResponse.data?.msg}"`)
								if (poeResponse.data?.errorCode === 0) {
									console.log(`   ✓ SUCCESS with full port object!`)
								}
							} catch (e) {
								console.log(`   Failed: ${e.response?.data?.msg || e.message}`)
							}

							// Try format 11: Use MAC without dashes
							try {
								console.log(`\n   Attempt 11: Try MAC without dashes in URL`)
								const poeUrlNoDashes = `/${controllerId}/api/v2/sites/${site}/switches/${targetMacNoDashes}/ports/${targetPort}`
								const poeResponse = await http.patch(poeUrlNoDashes, {
									overrides: {
										enable_poe: false
									}
								})
								console.log(`   Result: errorCode=${poeResponse.data?.errorCode}, msg="${poeResponse.data?.msg}"`)
								if (poeResponse.data?.errorCode === 0) {
									console.log(`   ✓ SUCCESS with MAC no dashes!`)
								}
							} catch (e) {
								console.log(`   Failed: ${e.response?.data?.msg || e.message}`)
							}

							// Try format 12: THE CORRECT FORMAT FROM WEB UI!
							console.log(`\n   Attempt 12: Web UI format - Turn PoE OFF`)
							try {
								const poeResponse = await http.patch(poeUrl, {
									name: port.name,
									profileId: port.profileId,
									profileOverrideEnable: true,
									dhcpL2RelaySettings: { enable: false },
									operation: "switching",
									linkSpeed: 0,
									duplex: 0,
									topoNotifyEnable: false,
									poe: 0,  // 0 = OFF
									dot1x: 2,
									bandWidthCtrlType: 0,
									loopbackDetectEnable: false,
									spanningTreeEnable: false,
									loopbackDetectVlanBasedEnable: false,
									portIsolationEnable: false,
									flowControlEnable: false,
									eeeEnable: false,
									lldpMedEnable: true
								})
								console.log(`   Result: errorCode=${poeResponse.data?.errorCode}, msg="${poeResponse.data?.msg}"`)
								if (poeResponse.data?.errorCode === 0) {
									console.log(`   ✓ PoE turned OFF on port ${targetPort}`)
								}
							} catch (e) {
								console.log(`   Failed: ${e.response?.data?.msg || e.message}`)
							}

							// Now turn it back ON
							console.log(`\n   Attempt 13: Turn PoE back ON (poe: 1)`)
							try {
								const poeResponse = await http.patch(poeUrl, {
									name: port.name,
									profileId: port.profileId,
									profileOverrideEnable: true,
									dhcpL2RelaySettings: { enable: false },
									operation: "switching",
									linkSpeed: 0,
									duplex: 0,
									topoNotifyEnable: false,
									poe: 1,  // 1 = ON
									dot1x: 2,
									bandWidthCtrlType: 0,
									loopbackDetectEnable: false,
									spanningTreeEnable: false,
									loopbackDetectVlanBasedEnable: false,
									portIsolationEnable: false,
									flowControlEnable: false,
									eeeEnable: false,
									lldpMedEnable: true
								})
								console.log(`   Result: errorCode=${poeResponse.data?.errorCode}, msg="${poeResponse.data?.msg}"`)
								if (poeResponse.data?.errorCode === 0) {
									console.log(`   ✓ PoE turned ON on port ${targetPort}`)
								}
							} catch (e) {
								console.log(`   Failed: ${e.response?.data?.msg || e.message}`)
							}
						} else {
							console.log(`   ⚠️  Port ${targetPort} not found in ports array`)
						}
					} else {
						console.log(`   ⚠️  No ports in switch details`)
						console.log(`   Switch data keys: ${Object.keys(switchData).join(', ')}`)
					}
				} else {
					console.log(`   ⚠️  API returned error code: ${switchResponse.data?.errorCode}`)
					console.log(`   Message: ${switchResponse.data?.msg}`)
				}
			} catch (switchError) {
				console.log(`   ❌ Failed to get switch details: ${switchError.message}`)
				if (switchError.response) {
					console.log(`   Response status: ${switchError.response.status}`)
					console.log(`   Response data: ${JSON.stringify(switchError.response.data, null, 2).substring(0, 500)}`)
				}
			}
		} else {
			console.log(`   ❌ Device ${targetMac} not found`)
			console.log(`   Available devices:`)
			devices.forEach(d => {
				console.log(`     - ${d.mac} (${d.name || 'unnamed'}) - ${d.type}`)
			})
		}

		// Logout
		console.log('\n8. Logging out...')
		await http.post(`/${controllerId}/api/v2/logout`)
		console.log('   ✓ Logged out')

		console.log('\n=== Test Complete ===')

	} catch (error) {
		console.error('\n❌ ERROR:', error.message)
		if (error.response) {
			console.error('Response status:', error.response.status)
			console.error('Response data:', JSON.stringify(error.response.data, null, 2))
		}
		process.exit(1)
	}
}

testConnection()
