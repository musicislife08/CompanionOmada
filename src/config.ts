import { SomeCompanionConfigField, Regex } from '@companion-module/base'

/**
 * Configuration interface for the Omada module
 */
export interface ModuleConfig {
	host: string
	port: number
	username: string
	password: string
	site: string
	verifySsl: boolean
}

/**
 * Returns the configuration fields displayed in Companion's module config page
 */
export function GetConfigFields(): SomeCompanionConfigField[] {
	return [
		{
			type: 'static-text',
			id: 'info',
			width: 12,
			label: 'Omada Controller Information',
			value: 'Configure connection to your TP-Link Omada controller. Note: You must use a local account (not cloud account) and 2FA must be disabled for API access.',
		},
		{
			type: 'textinput',
			id: 'host',
			label: 'Controller IP Address',
			tooltip: 'IP address or hostname of your Omada controller',
			width: 8,
			regex: Regex.HOSTNAME,
			required: true,
		},
		{
			type: 'number',
			id: 'port',
			label: 'Port',
			tooltip: 'HTTPS port (typically 8043)',
			width: 4,
			min: 1,
			max: 65535,
			default: 8043,
			required: true,
		},
		{
			type: 'textinput',
			id: 'username',
			label: 'Username',
			tooltip: 'Local administrator username',
			width: 6,
			required: true,
		},
		{
			type: 'secret-text',
			id: 'password',
			label: 'Password',
			tooltip: 'Local administrator password',
			width: 6,
			required: true,
		},
		{
			type: 'textinput',
			id: 'site',
			label: 'Site Name',
			tooltip: 'Name of the site in Omada controller (usually "Default")',
			width: 6,
			default: 'Default',
			required: true,
		},
		{
			type: 'checkbox',
			id: 'verifySsl',
			label: 'Verify SSL Certificate',
			tooltip: 'Disable this for self-signed certificates (common with OC200/OC300)',
			width: 6,
			default: false,
		},
	]
}
