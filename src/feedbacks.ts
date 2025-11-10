import {
	CompanionFeedbackDefinitions,
	CompanionFeedbackBooleanEvent,
	combineRgb,
} from '@companion-module/base'
import type { OmadaModuleInstance } from './main.js'

/**
 * Define the available feedbacks for the Omada module
 */
export function UpdateFeedbacks(instance: OmadaModuleInstance): void {
	const feedbacks: CompanionFeedbackDefinitions = {
		/**
		 * Feedback: PoE Port State
		 * Returns true when PoE is enabled on the specified port
		 */
		poe_state: {
			type: 'boolean',
			name: 'PoE Port State',
			description: 'Change button appearance based on PoE port state',
			defaultStyle: {
				bgcolor: combineRgb(0, 200, 0), // Green when PoE is ON
				color: combineRgb(255, 255, 255), // White text
			},
			options: [
				{
					type: 'dropdown',
					label: 'Device',
					id: 'device_mac',
					default: '',
					tooltip: 'Select the switch to monitor',
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
					tooltip: 'Port number to monitor',
				},
			],
			callback: (feedback: CompanionFeedbackBooleanEvent): boolean => {
				return handlePoeStateFeedback(instance, feedback)
			},
		},

		/**
		 * Feedback: PoE Port Off State
		 * Returns true when PoE is disabled on the specified port
		 */
		poe_state_off: {
			type: 'boolean',
			name: 'PoE Port Off State',
			description: 'Change button appearance when PoE is disabled',
			defaultStyle: {
				bgcolor: combineRgb(200, 0, 0), // Red when PoE is OFF
				color: combineRgb(255, 255, 255), // White text
			},
			options: [
				{
					type: 'dropdown',
					label: 'Device',
					id: 'device_mac',
					default: '',
					tooltip: 'Select the switch to monitor',
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
					tooltip: 'Port number to monitor',
				},
			],
			callback: (feedback: CompanionFeedbackBooleanEvent): boolean => {
				return handlePoeStateOffFeedback(instance, feedback)
			},
		},
	}

	instance.setFeedbackDefinitions(feedbacks)
}

/**
 * Handle PoE state feedback (returns true when PoE is ON)
 */
function handlePoeStateFeedback(
	instance: OmadaModuleInstance,
	feedback: CompanionFeedbackBooleanEvent
): boolean {
	// Variables are automatically parsed by Companion when useVariables: true
	const deviceMac = String(feedback.options.device_mac)
	const portNumber = Number(feedback.options.port)

	// Check if PoE is enabled
	return instance.isPoeEnabled(deviceMac, portNumber)
}

/**
 * Handle PoE state OFF feedback (returns true when PoE is OFF)
 */
function handlePoeStateOffFeedback(
	instance: OmadaModuleInstance,
	feedback: CompanionFeedbackBooleanEvent
): boolean {
	// Variables are automatically parsed by Companion when useVariables: true
	const deviceMac = String(feedback.options.device_mac)
	const portNumber = Number(feedback.options.port)

	// Check if PoE is disabled (inverse of enabled)
	return !instance.isPoeEnabled(deviceMac, portNumber)
}
