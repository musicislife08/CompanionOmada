# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

### Install dependencies
```bash
yarn install --ignore-engines  # Required due to Node.js version compatibility
```

### Build the module
```bash
yarn build  # Compiles TypeScript and packages the module to .tgz
```

### Development mode
```bash
yarn dev  # Auto-rebuild on file changes for use with Companion
```

### Compile TypeScript only
```bash
npx tsc  # Outputs to dist/ directory
```

### Test in Companion
1. Set "Developer modules path" in Companion launcher/settings to this repository directory
2. Restart Companion or reload modules
3. Add module as a connection and test with real Omada controller

## Architecture Overview

### Module Structure
This is a Bitfocus Companion v3 module following the `@companion-module/base` framework.

**Key Components:**
- `src/main.ts` - OmadaModuleInstance extends InstanceBase, orchestrates lifecycle
- `src/omada-client.ts` - OmadaClient handles all API communication with controller
- `src/actions.ts` - Defines PoE control actions (enable/disable/toggle)
- `src/feedbacks.ts` - Boolean feedbacks for PoE port state visualization
- `src/config.ts` - Configuration fields for Companion UI

### Data Flow

1. **Initialization**:
   - main.ts creates OmadaClient with config
   - OmadaClient.login() → get controllerId → authenticate → extract cookies → resolve site key
   - refreshDevices() → populate deviceCache and switchDetailsCache
   - Start 5-second polling interval

2. **Action Execution (Optimistic Update Pattern)**:
   - User presses button → action callback
   - togglePortPoe() sends API request
   - **Immediately** update cached portStatus.poe (optimistic)
   - checkFeedbacks() for instant visual update (0ms)
   - Schedule 30s confirmation timeout
   - After 30s: getSwitchDetails() → update cache with actual state

3. **Feedback Updates**:
   - 5-second polling → refreshDevices()
   - deviceCache + switchDetailsCache updated
   - checkFeedbacks() triggers visual updates

4. **Reconnection**:
   - On failure → scheduleReconnect() retries every 30 seconds
   - Logs out → waits 30s → calls initConnection() again

### State Management

**deviceCache** (Map<string, OmadaDevice>): Device list cache
- Populated by `refreshDevices()` every 5 seconds
- Keyed by device MAC address
- Contains basic device info (name, MAC, type, status)

**switchDetailsCache** (Map<string, any>): Switch details with port status
- Populated during `refreshDevices()` for all switches
- Contains full port arrays with `portStatus.poe` boolean
- Used by `isPoeEnabled()` to check PoE state
- Required for accurate PoE status on OC200 hardware controllers

**confirmationTimeouts** (Map<string, NodeJS.Timeout>): Optimistic update tracking
- Keyed by `${deviceMac}:${portNumber}`
- Schedules 30-second delayed confirmations after PoE toggles
- Provides instant feedback while waiting for slow hardware (8-12+ seconds)

**Session Management**:
- CSRF token stored in OmadaClient (`this.token`)
- Cookies stored as array (`this.cookies`) - required for OC200
- Cookie: TPOMADA_SESSIONID extracted from login response
- Token set as axios default header: `Csrf-Token`
- Cookies set as axios default header: `Cookie`

### Omada API Implementation

**Authentication Flow:**
1. GET `/api/info` → extract controllerId (hex ID like "eaa02637ebf26168826493c48c4eabe6")
2. POST `/{controllerId}/api/v2/login` → get CSRF token + cookies
3. Extract `TPOMADA_SESSIONID` cookie from `set-cookie` header (required for OC200)
4. Set token as `Csrf-Token` header and cookies as `Cookie` header for all future requests
5. Call `resolveSiteKey()` to convert site name (e.g., "McLellan") to site key (e.g., "63b848928700913f597896c2")
   - GET `/{controllerId}/api/v2/users/current` → get user privileges
   - Find matching site by name in `result.privilege.sites[]`
   - Update `this.siteId` with the site key (required for OC200 hardware controllers)

**PoE Control (Profile-Based):**
1. GET `/{controllerId}/api/v2/sites/{siteId}/switches/{mac}` → get switch details with ports
2. Find target port in `ports[]` array
3. GET `/{controllerId}/api/v2/sites/{siteId}/setting/lan/profiles/{profileId}` → get port profile
4. PATCH `/{controllerId}/api/v2/sites/{siteId}/switches/{mac}/ports/{port}` with:
   - All existing profile settings (linkSpeed, duplex, dot1x, operation, etc.)
   - `profileOverrideEnable: true` (required)
   - `poe: 0` (OFF) or `poe: 1` (ON) - **numbers, not booleans**
5. **Critical**: Must send complete port config, not just overrides
6. Gateway PoE: PATCH `/{controllerId}/api/v2/sites/{siteId}/gateways/{mac}/ports/{port}`

**Why Profile-Based?**
- Prevents breaking existing port configuration (VLAN, speed, 802.1x, etc.)
- Only overrides the PoE field while preserving all other settings

**Port Status:**
- Retrieved via GET `/{controllerId}/api/v2/sites/{siteId}/switches/{mac}` for detailed switch info
- For OC200 hardware controllers, check `portStatus.poe === true` (boolean in portStatus object)
- Device list: GET `/{controllerId}/api/v2/sites/{siteId}/devices`
- OC200 returns: `{ errorCode: 0, msg: "Success.", result: [...] }` (array in result field)
- Software controllers may return different formats

### Critical Details

**Optimistic Updates (Hardware Delay Handling):**
- Omada hardware can be slow: PoE OFF ~8s, PoE ON ~10-12+ seconds
- `togglePortPoe()` immediately updates cached state (optimistic update)
- Triggers `checkFeedbacks()` instantly for immediate visual response
- Schedules 30-second delayed confirmation to verify actual hardware state
- If toggle fails, immediately refreshes to get correct state
- Provides good UX while accommodating slow hardware response times

**Polling Strategy:**
- Feedbacks require real-time state → 5-second polling interval
- Polling errors logged but don't trigger reconnect immediately
- Only initial connection failures trigger 30-second reconnect cycle
- `refreshDevices()` populates both deviceCache and switchDetailsCache
- Switch details fetched for ALL switches during each poll (for PoE status)

**Error Handling:**
- 401 responses → automatic re-login + retry (in omada-client.ts)
- Connection errors → scheduleReconnect() with 30s backoff
- Invalid MAC/port → logged, no state change

**TypeScript Compilation:**
- Must compile TS to JS before `yarn build` can package
- Build tool expects `dist/main.js` as entrypoint (see manifest.json)
- LogLevel type must be imported from '@companion-module/base'

## Companion Module Conventions

**manifest.json**: Lives in `companion/` directory, defines runtime.entrypoint, manufacturer, products
**HELP.md**: User-facing documentation in `companion/` directory
**Actions**: Async callbacks, use `parseVariablesInString()` from context for variable support
**Feedbacks**:
- Boolean type returns true/false for styling, polled via `checkFeedbacks()`
- Callbacks are synchronous (not async)
- Variables auto-parsed when `useVariables: true` is set on field
- **Do NOT call instance.parseVariablesInString()** - use context parameter instead
**Instance Status**: Use InstanceStatus enum (Ok, ConnectionFailure, BadConfig, etc.)
**Config Fields**:
- Use `type: 'secret-text'` for passwords (masked input)
- Use `type: 'textinput'` for regular text
- Use `type: 'number'` for numeric inputs

## Omada Controller Requirements

- Local account required (cloud accounts don't support API)
- 2FA must be disabled for API user
- SSL verification often disabled due to self-signed certs on OC200/OC300
- Web API v2 used (NOT Open API - has daily limits)
- Compatible with controller versions 5.5.7 - 5.12.x+

**OC200 Hardware Controllers:**
- Use port **443** (not 8043 like software controllers)
- Require cookie-based session management (TPOMADA_SESSIONID)
- Require site key resolution (hex IDs instead of site names)
- Return devices in `result` array: `{ errorCode: 0, msg: "Success.", result: [...] }`
- PoE status in `portStatus.poe` boolean (not top-level `poe` field)

**Software Controllers:**
- Typically use port 8043 (HTTPS)
- May work with site names directly (no resolution needed)
- May return different response formats

## Testing

**Standalone Test Scripts:**
- `test-connection.mjs` - Basic API connection testing without Companion
- `test-poe-toggle.mjs` - Profile-based PoE toggle with hardware timing tests
- `test-module-client.mjs` - Test actual OmadaClient class methods

**Environment Setup:**
- Create `.env` file (excluded from git) with:
  ```
  OMADA_HOST=192.168.x.x
  OMADA_PORT=443
  OMADA_USERNAME=admin
  OMADA_PASSWORD=yourpassword
  OMADA_SITE=Default
  ```
- Run tests with: `node test-connection.mjs`

**Testing in Companion:**
1. Set "Developer modules path" in Companion settings to repo directory
2. Build module: `yarn build`
3. Restart Companion or reload modules
4. Add module as connection, configure with controller details
5. Check Companion logs for detailed INFO-level debugging

## Known Issues & Quirks

**Hardware Response Times:**
- PoE changes can take 8-12+ seconds to apply on actual hardware
- Optimistic updates provide instant feedback while hardware catches up
- 30-second confirmation timeout accommodates slowest hardware

**OC200 Requirements:**
- **Must** preserve cookies across requests (TPOMADA_SESSIONID)
- **Must** resolve site names to hex keys before API calls
- Site key format: 24-character hex string (e.g., "63b848928700913f597896c2")
- Port 443 only (8043 won't work)

**Profile-Based PoE Control:**
- **Cannot** send partial updates - must send complete port configuration
- **Must** fetch profile first to get all settings (linkSpeed, duplex, dot1x, etc.)
- **Must** use `poe: 0` or `poe: 1` (numbers) - booleans will fail validation
- **Must** set `profileOverrideEnable: true` or API returns -1 (General error)

**Response Format Variations:**
- OC200 returns: `{ errorCode: 0, msg: "Success.", result: [...] }`
- Software controllers may return arrays directly
- Code handles both formats in `getDevices()`

## Version History

**v1.0.7** - Password field security
- Changed password config field to `secret-text` type for masked input

**v1.0.6** - Feedback fixes
- Fixed parseVariablesInString deprecation warning
- Removed manual variable parsing (Companion handles automatically)
- Added MIT LICENSE file

**v1.0.5** - Site key resolution & logging
- Enhanced INFO-level logging for site key resolution debugging
- Fixed site key resolution for OC200 hardware controllers

**v1.0.4** - Hardware delay handling
- Implemented optimistic updates with 30-second confirmation
- Instant feedback while hardware catches up (8-12+ seconds)

**v1.0.3** - Profile-based PoE control
- Switched to profile-based configuration to preserve port settings
- Added getPortProfile() method
- Only overrides PoE field, preserves all other settings

**v1.0.2** - Cookie preservation
- Added cookie storage and injection for OC200 support
- TPOMADA_SESSIONID cookie required for hardware controllers

**v1.0.1** - Initial OC200 support
- Basic authentication flow
- Device listing
- PoE control (initial hardcoded version)

**v1.0.0** - Initial release
- Basic module structure for software controllers
