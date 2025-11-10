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

		// Logout
		console.log('\n5. Logging out...')
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
