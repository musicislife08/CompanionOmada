/**
 * Verification harness: proves init() returns inside Companion's 10s RPC deadline
 * even though the controller takes far longer than that to connect.
 *
 * Runs OmadaModuleInstance's real init()/initConnection() against the real
 * controller, stubbing only the InstanceBase plumbing that needs Companion's IPC.
 */
import dotenv from 'dotenv'
dotenv.config({ quiet: true })

// main.js calls runEntrypoint() on import, which aborts the process when it can't
// find Companion's IPC. Neutralise that so the harness survives to observe results.
const realExit = process.exit.bind(process)
process.exit = () => {}
process.on('unhandledRejection', () => {})

const { OmadaModuleInstance } = await import('./dist/main.js')

const COMPANION_INIT_DEADLINE_MS = 10000

function makeInstance(label) {
	const inst = Object.create(OmadaModuleInstance.prototype)
	// Fields normally set by the class constructor
	inst.config = {}
	inst.client = undefined
	inst.deviceCache = new Map()
	inst.switchDetailsCache = new Map()
	inst.confirmationTimeouts = new Map()
	inst.isDestroyed = false
	inst.connectionGeneration = 0
	// InstanceBase plumbing
	inst.statusHistory = []
	inst.log = (level, msg) => {
		if (level === 'error' || level === 'warn') console.log(`      [${label}] ${level}: ${msg}`)
	}
	inst.updateStatus = (status, message) => {
		inst.statusHistory.push(message ? `${status} (${message})` : status)
		console.log(`      [${label}] status -> ${inst.statusHistory.at(-1)}`)
	}
	inst.setActionDefinitions = () => {}
	inst.setFeedbackDefinitions = () => {}
	inst.checkFeedbacks = () => {}
	return inst
}

async function run(label, config, waitMs) {
	console.log(`\n--- ${label} ---`)
	const inst = makeInstance(label)

	const t0 = Date.now()
	await inst.init(config)
	const initMs = Date.now() - t0

	const verdict = initMs < COMPANION_INIT_DEADLINE_MS ? 'PASS' : 'FAIL'
	console.log(`      init() returned in ${initMs}ms  -> ${verdict} (deadline ${COMPANION_INIT_DEADLINE_MS}ms)`)

	// Let the background connection finish and observe the outcome
	await new Promise((r) => setTimeout(r, waitMs))
	console.log(`      after ${waitMs}ms, status history: ${inst.statusHistory.join(' | ')}`)
	console.log(`      process still alive: ${process.uptime() > 0}`)
	console.log(`      reconnect scheduled: ${inst.reconnectTimeout !== undefined}`)

	inst.isDestroyed = true
	await inst.destroy()
	return { initMs, verdict, statuses: inst.statusHistory }
}

const reachable = await run(
	'REACHABLE controller (17s of work)',
	{
		host: process.env.OMADA_HOST,
		port: Number(process.env.OMADA_PORT),
		username: process.env.OMADA_USERNAME,
		password: process.env.OMADA_PASSWORD,
		site: process.env.OMADA_SITE,
		verifySsl: false,
		timeout: 30,
	},
	25000
)

const blackhole = await run(
	'UNREACHABLE host (packets dropped, 5s timeout)',
	{
		host: '192.0.2.1', // TEST-NET-1, black-holed by definition
		port: 443,
		username: 'x',
		password: 'x',
		site: 'Default',
		verifySsl: false,
		timeout: 5,
	},
	8000
)

console.log('\n=== SUMMARY ===')
console.log(`reachable:  init ${reachable.initMs}ms ${reachable.verdict}  final status: ${reachable.statuses.at(-1)}`)
console.log(`unreachable: init ${blackhole.initMs}ms ${blackhole.verdict}  final status: ${blackhole.statuses.at(-1)}`)
realExit(reachable.verdict === 'PASS' && blackhole.verdict === 'PASS' ? 0 : 1)
