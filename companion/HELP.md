# TP-Link Omada Controller Module

This module allows Bitfocus Companion to control Power over Ethernet (PoE) on TP-Link Omada managed switches and gateways.

## Features

- Enable/disable PoE on individual ports
- Toggle PoE state
- Real-time feedback showing PoE status
- Automatic reconnection on connection loss
- Support for both hardware controllers (OC200/OC300) and software controllers

## Configuration

### Prerequisites

1. **Omada Controller**: Hardware controller (OC200/OC300), software controller, or Omada Pro
2. **Controller Version**: v5.5.7 or newer recommended
3. **Local Account**: You must use a local administrator account (cloud accounts are not supported)
4. **2FA Disabled**: Two-factor authentication must be disabled for API access
5. **Network Access**: Companion must be able to reach the controller on the network

### Module Settings

- **Controller IP Address**: The IP address or hostname of your Omada controller
- **Port**: HTTPS port (typically 8043 for hardware/software controllers)
- **Username**: Local administrator username
- **Password**: Local administrator password
- **Site Name**: Name of your site in the Omada controller (usually "Default")
- **Verify SSL Certificate**: Disable this for self-signed certificates (common with OC200/OC300)

## Finding Your Device MAC Address

To control PoE on a port, you need the MAC address of the switch or gateway:

1. Log into your Omada Controller web interface
2. Navigate to **Devices**
3. Click on the device you want to control
4. The MAC address is displayed in the device details (format: `1C-61-B4-XX-XX-XX`)

**Tip**: Use copy/paste to ensure the MAC address is entered correctly in your Companion buttons.

## Actions

### Enable PoE
Turns on PoE for a specific port.

**Options:**
- Device MAC Address (e.g., `1C-61-B4-12-34-56`)
- Port Number (1-52)

### Disable PoE
Turns off PoE for a specific port.

**Options:**
- Device MAC Address (e.g., `1C-61-B4-12-34-56`)
- Port Number (1-52)

### Toggle PoE
Toggles the PoE state for a specific port (ON → OFF or OFF → ON).

**Options:**
- Device MAC Address (e.g., `1C-61-B4-12-34-56`)
- Port Number (1-52)

## Feedbacks

### PoE Port State
Changes button appearance when PoE is **enabled** on the specified port.

**Default Style:** Green background when PoE is ON

**Options:**
- Device MAC Address
- Port Number

### PoE Port Off State
Changes button appearance when PoE is **disabled** on the specified port.

**Default Style:** Red background when PoE is OFF

**Options:**
- Device MAC Address
- Port Number

## Example Button Configuration

### Toggle Button with Status Feedback

1. Create a new button
2. Add action: **Toggle PoE**
   - Device MAC: `1C-61-B4-12-34-56`
   - Port Number: `8`
3. Add feedback: **PoE Port State**
   - Device MAC: `1C-61-B4-12-34-56`
   - Port Number: `8`
   - Style: Green background
4. Add feedback: **PoE Port Off State**
   - Device MAC: `1C-61-B4-12-34-56`
   - Port Number: `8`
   - Style: Red background

Now the button will toggle PoE when pressed and display green when ON, red when OFF.

## Troubleshooting

### Connection Issues

**"Cannot connect to controller - check IP and port"**
- Verify the controller IP address and port are correct
- Ensure Companion can reach the controller on your network
- Try pinging the controller from the Companion machine

**"Invalid username or password"**
- Verify you're using a **local** account (not cloud account)
- Check username and password are correct
- Ensure the account has administrator privileges

**"SSL certificate error"**
- Disable "Verify SSL Certificate" in module settings
- This is common with self-signed certificates on OC200/OC300

### PoE Control Issues

**"Device not found"**
- Verify the MAC address is correct (check in Omada controller)
- Ensure the device is online and adopted
- Check that you're using the correct site name

**"Port not found"**
- Verify the port number is valid for your device
- Some devices may have fewer ports than specified

**"Failed to update port PoE"**
- Check that the port supports PoE
- Verify the device is not in a locked/managed state
- Try manually controlling PoE through the Omada web interface first

### Status Feedback Not Updating

- The module polls for updates every 5 seconds
- Check that the module status shows "OK" (green)
- Verify the device MAC and port number are correct in the feedback settings

## Support

For issues and feature requests, please visit:
https://github.com/bitfocus/companion-module-tplink-omada

## Compatibility

**Tested Controllers:**
- Omada Software Controller v5.5.7 - v5.12.x
- OC200/OC300 Hardware Controllers v5.12+

**Tested Devices:**
- TL-SG2428P (24-port PoE switch)
- TL-SG2008P (8-port PoE switch)
- TL-SG3428XMP (28-port PoE switch)
- Various Omada gateways with PoE ports

**Note:** Cloud-Based Controller (CBC) does NOT support this module.
