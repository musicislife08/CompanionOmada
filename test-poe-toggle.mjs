#!/usr/bin/env node

/**
 * Test PoE toggle with profile settings and polling for hardware confirmation
 * Run with: node test-poe-toggle.mjs
 */

import axios from 'axios'
import https from 'https'
import dotenv from 'dotenv'

dotenv.config()

const targetMac = '5C-62-8B-AE-F1-F7'
const targetPort = 16

async function testPoeToggle() {
	console.log('=== PoE Toggle Test with Profile Settings ===\n')

	const host = process.env.OMADA_HOST
	const port = process.env.OMADA_PORT || '443'
	const username = process.env.OMADA_USERNAME
	const password = process.env.OMADA_PASSWORD
	const site = process.env.OMADA_SITE || 'Default'

	const baseUrl = `https://${host}:${port}`
	const http = axios.create({
		baseURL: baseUrl,
		httpsAgent: new https.Agent({ rejectUnauthorized: false }),
		timeout: 10000,
		headers: { 'Content-Type': 'application/json' },
	})

	try {
		// Login
		console.log('1. Logging in...')
		const infoResponse = await http.get('/api/info')
		const controllerId = infoResponse.data.result.omadacId

		const loginResponse = await http.post(`/${controllerId}/api/v2/login`, { username, password })
		const token = loginResponse.data.result.token
		const cookies = loginResponse.headers['set-cookie']

		http.defaults.headers.common['Csrf-Token'] = token
		if (cookies) {
			http.defaults.headers.common['Cookie'] = cookies.map(c => c.split(';')[0]).join('; ')
		}
		console.log('   ✓ Logged in\n')

		// Get site key
		console.log('2. Getting site key...')
		const userInfoResponse = await http.get(`/${controllerId}/api/v2/users/current`)
		const userSites = userInfoResponse.data.result.privilege.sites
		const matchingSite = userSites.find(s => s.name === site)
		const siteKey = matchingSite.key
		console.log(`   ✓ Site: ${site} -> ${siteKey}\n`)

		// Get switch details
		console.log('3. Getting switch details...')
		const switchResponse = await http.get(`/${controllerId}/api/v2/sites/${siteKey}/switches/${targetMac}`)
		const switchData = switchResponse.data.result
		const portData = switchData.ports?.find(p => p.port === targetPort)

		if (!portData) {
			throw new Error(`Port ${targetPort} not found`)
		}

		console.log(`   Switch: ${switchData.name}`)
		console.log(`   Port ${targetPort}: ${portData.name}`)
		console.log(`   Current PoE: ${portData.portStatus?.poe ? 'ON' : 'OFF'}`)
		console.log(`   Profile: ${portData.profileId}\n`)

		// Get port profile
		console.log('4. Getting port profile...')
		const profileResponse = await http.get(
			`/${controllerId}/api/v2/sites/${siteKey}/setting/lan/profiles/${portData.profileId}`
		)
		const profile = profileResponse.data.result
		console.log(`   ✓ Profile: "${profile.name}"`)
		console.log(`   Settings: linkSpeed=${profile.linkSpeed}, duplex=${profile.duplex}, dot1x=${profile.dot1x}\n`)

		// Helper: Get current PoE state
		async function getCurrentPoeState() {
			const resp = await http.get(`/${controllerId}/api/v2/sites/${siteKey}/switches/${targetMac}`)
			const port = resp.data.result.ports?.find(p => p.port === targetPort)
			return port?.portStatus?.poe === true
		}

		// Helper: Build port config with profile settings
		function buildPortConfig(poeState) {
			return {
				name: portData.name,
				profileId: portData.profileId,
				profileOverrideEnable: true,
				dhcpL2RelaySettings: profile.dhcpL2RelaySettings || { enable: false },
				operation: profile.operation || 'switching',
				linkSpeed: profile.linkSpeed ?? 0,
				duplex: profile.duplex ?? 0,
				topoNotifyEnable: profile.topoNotifyEnable ?? false,
				poe: poeState ? 1 : 0,  // 0 = OFF, 1 = ON
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
		}

		// Helper: Wait for PoE state
		async function waitForPoeState(targetState, maxWaitMs = 10000) {
			const startTime = Date.now()
			let attempts = 0

			while (Date.now() - startTime < maxWaitMs) {
				attempts++
				const currentState = await getCurrentPoeState()
				const elapsed = Date.now() - startTime
				console.log(`     [${elapsed}ms] Poll ${attempts}: PoE is ${currentState ? 'ON' : 'OFF'}`)

				if (currentState === targetState) {
					console.log(`     ✅ Hardware confirmed PoE is ${targetState ? 'ON' : 'OFF'} (${elapsed}ms)\n`)
					return true
				}

				await new Promise(resolve => setTimeout(resolve, 500))
			}

			console.log(`     ⚠️  Timeout: PoE did not reach ${targetState ? 'ON' : 'OFF'} after ${maxWaitMs}ms\n`)
			return false
		}

		// TEST 1: Turn PoE OFF
		console.log('--- TEST 1: Turn PoE OFF ---')
		const poeUrl = `/${controllerId}/api/v2/sites/${siteKey}/switches/${targetMac}/ports/${targetPort}`
		const offConfig = buildPortConfig(false)

		const offResponse = await http.patch(poeUrl, offConfig)
		if (offResponse.data?.errorCode === 0) {
			console.log('   ✓ API call successful')
			console.log('   Waiting for hardware to apply change...')
			await waitForPoeState(false)
		} else {
			console.log(`   ❌ API error: ${offResponse.data?.msg}`)
		}

		// TEST 2: Turn PoE back ON
		console.log('--- TEST 2: Turn PoE back ON ---')
		const onConfig = buildPortConfig(true)

		const onResponse = await http.patch(poeUrl, onConfig)
		if (onResponse.data?.errorCode === 0) {
			console.log('   ✓ API call successful')
			console.log('   Waiting for hardware to apply change...')
			await waitForPoeState(true)
		} else {
			console.log(`   ❌ API error: ${onResponse.data?.msg}`)
		}

		// Logout
		await http.post(`/${controllerId}/api/v2/logout`)
		console.log('✅ Test complete!')

	} catch (error) {
		console.error('\n❌ ERROR:', error.message)
		if (error.response) {
			console.error('Response:', error.response.status, error.response.data)
		}
		process.exit(1)
	}
}

testPoeToggle()
