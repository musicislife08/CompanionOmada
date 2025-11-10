import { CompanionActionDefinitions, CompanionActionEvent, InstanceStatus } from '@companion-module/base'
import type { OmadaModuleInstance } from './main.js'

/**
 * Define the available actions for the Omada module
 */
export function UpdateActions(instance: OmadaModuleInstance): void {
	const actions: CompanionActionDefinitions = {
		/**
		 * Action: Enable PoE on a port
		 */
		poe_enable: {
			name: 'Enable PoE',
			description: 'Turn on PoE for a specific port',
			options: [
				{
					type: 'dropdown',
					label: 'Device',
					id: 'device_mac',
					default: '',
					tooltip: 'Select the switch to control',
					choices: instance.getDeviceChoices(),
					allowCustom: true,
				},
				{
					type: 'number',
					label: 'Port Number',
					id: 'port',
					min: 1,
					max: 52,
					default: 1,
					tooltip: 'Port number to enable PoE on',
				},
			],
			callback: async (event: CompanionActionEvent) => {
				await handlePoeAction(instance, event, true)
			},
		},

		/**
		 * Action: Disable PoE on a port
		 */
		poe_disable: {
			name: 'Disable PoE',
			description: 'Turn off PoE for a specific port',
			options: [
				{
					type: 'dropdown',
					label: 'Device',
					id: 'device_mac',
					default: '',
					tooltip: 'Select the switch to control',
					choices: instance.getDeviceChoices(),
					allowCustom: true,
				},
				{
					type: 'number',
					label: 'Port Number',
					id: 'port',
					min: 1,
					max: 52,
					default: 1,
					tooltip: 'Port number to disable PoE on',
				},
			],
			callback: async (event: CompanionActionEvent) => {
				await handlePoeAction(instance, event, false)
			},
		},

		/**
		 * Action: Toggle PoE on a port
		 */
		poe_toggle: {
			name: 'Toggle PoE',
			description: 'Toggle PoE state for a specific port',
			options: [
				{
					type: 'dropdown',
					label: 'Device',
					id: 'device_mac',
					default: '',
					tooltip: 'Select the switch to control',
					choices: instance.getDeviceChoices(),
					allowCustom: true,
				},
				{
					type: 'number',
					label: 'Port Number',
					id: 'port',
					min: 1,
					max: 52,
					default: 1,
					tooltip: 'Port number to toggle PoE on',
				},
			],
			callback: async (event: CompanionActionEvent) => {
				await handlePoeToggle(instance, event)
			},
		},
	}

	instance.setActionDefinitions(actions)
}

/**
 * Handle PoE enable/disable action
 */
async function handlePoeAction(
	instance: OmadaModuleInstance,
	event: CompanionActionEvent,
	enablePoe: boolean
): Promise<void> {
	// Parse variables in device MAC
	const deviceMac = await instance.parseVariablesInString(String(event.options.device_mac))
	const portNumber = Number(event.options.port)

	// Validate inputs
	if (!deviceMac || deviceMac.trim() === '') {
		instance.log('warn', 'Device MAC address is required')
		return
	}

	if (!instance.client) {
		instance.log('error', 'Not connected to Omada controller')
		return
	}

	try {
		instance.log(
			'info',
			`${enablePoe ? 'Enabling' : 'Disabling'} PoE on port ${portNumber} of device ${deviceMac}`
		)

		// Use togglePortPoe which handles optimistic update and delayed confirmation
		await instance.togglePortPoe(deviceMac, portNumber, enablePoe)

		instance.log('info', `PoE ${enablePoe ? 'enabled' : 'disabled'} successfully`)
	} catch (error) {
		const err = error as Error
		instance.log('error', `Failed to update PoE: ${err.message}`)
		instance.updateStatus(InstanceStatus.UnknownError, err.message)
	}
}

/**
 * Handle PoE toggle action
 */
async function handlePoeToggle(instance: OmadaModuleInstance, event: CompanionActionEvent): Promise<void> {
	// Parse variables in device MAC
	const deviceMac = await instance.parseVariablesInString(String(event.options.device_mac))
	const portNumber = Number(event.options.port)

	// Validate inputs
	if (!deviceMac || deviceMac.trim() === '') {
		instance.log('warn', 'Device MAC address is required')
		return
	}

	if (!instance.client) {
		instance.log('error', 'Not connected to Omada controller')
		return
	}

	try {
		// Get current PoE state
		const currentState = instance.isPoeEnabled(deviceMac, portNumber)
		const newState = !currentState

		instance.log('info', `Toggling PoE on port ${portNumber} of device ${deviceMac} (${currentState} -> ${newState})`)

		// Use togglePortPoe which handles optimistic update and delayed confirmation
		await instance.togglePortPoe(deviceMac, portNumber, newState)

		instance.log('info', `PoE toggled to ${newState ? 'enabled' : 'disabled'}`)
	} catch (error) {
		const err = error as Error
		instance.log('error', `Failed to toggle PoE: ${err.message}`)
		instance.updateStatus(InstanceStatus.UnknownError, err.message)
	}
}
