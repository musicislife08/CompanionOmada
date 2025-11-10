#!/usr/bin/env node

/**
 * Test the actual OmadaClient class methods to debug site key resolution
 * Run with: node test-module-client.mjs
 */

import dotenv from 'dotenv'

dotenv.config()

// Import the built module code
import { OmadaClient } from './dist/omada-client.js'

async function testModuleClient() {
	console.log('=== Testing OmadaClient Methods ===\n')

	const config = {
		host: process.env.OMADA_HOST,
		port: process.env.OMADA_PORT || '443',
		username: process.env.OMADA_USERNAME,
		password: process.env.OMADA_PASSWORD,
		site: process.env.OMADA_SITE || 'Default',
		verifySsl: false
	}

	console.log('Config:')
	console.log(`  Host: ${config.host}:${config.port}`)
	console.log(`  Site: ${config.site}`)
	console.log(`  SSL Verify: ${config.verifySsl}\n`)

	// Create logger
	const logCallback = (level, message) => {
		const timestamp = new Date().toISOString().substring(11, 23)
		console.log(`[${timestamp}] ${level.toUpperCase()}: ${message}`)
	}

	// Create client
	console.log('Creating OmadaClient...')
	const client = new OmadaClient(config, logCallback)

	try {
		// Login (should resolve site key)
		console.log('\n--- Login (with site key resolution) ---')
		await client.login()

		// Get devices
		console.log('\n--- Get Devices ---')
		const devices = await client.getDevices()
		console.log(`Retrieved ${devices.length} devices`)

		if (devices.length > 0) {
			console.log('\nDevices:')
			devices.forEach(d => {
				console.log(`  - ${d.name || 'unnamed'} (${d.mac}) - ${d.type}`)
			})
		}

		// Get switch details
		const targetMac = '5C-62-8B-AE-F1-F7'
		console.log(`\n--- Get Switch Details (${targetMac}) ---`)
		const switchDetails = await client.getSwitchDetails(targetMac)
		console.log(`Switch: ${switchDetails.name}`)
		console.log(`Ports: ${switchDetails.ports?.length || 0}`)

		if (switchDetails.ports) {
			const port16 = switchDetails.ports.find(p => p.port === 16)
			if (port16) {
				console.log(`\nPort 16:`)
				console.log(`  Name: ${port16.name}`)
				console.log(`  PoE Status: ${port16.portStatus?.poe ? 'ON' : 'OFF'}`)
				console.log(`  PoE Power: ${port16.portStatus?.poePower}W`)
			}
		}

		// Get PoE status
		console.log('\n--- Get PoE Status (port 16) ---')
		const poeStatus = await client.getPortPoeStatus(targetMac, 16)
		console.log(`PoE is: ${poeStatus ? 'ENABLED' : 'DISABLED'}`)

		// Logout
		console.log('\n--- Logout ---')
		await client.logout()
		console.log('Logged out')

		console.log('\n✅ Test complete!')

	} catch (error) {
		console.error('\n❌ ERROR:', error.message)
		if (error.stack) {
			console.error(error.stack)
		}
		process.exit(1)
	}
}

testModuleClient()
