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

1. **Initialization**: main.ts creates OmadaClient → logs in → fetches devices → starts polling
2. **Action Execution**: User presses button → action callback → OmadaClient API call → refreshDevices() → checkFeedbacks()
3. **Feedback Updates**: 5-second polling → refreshDevices() → deviceCache updated → checkFeedbacks() triggers
4. **Reconnection**: On failure → scheduleReconnect() retries every 30 seconds

### State Management

**deviceCache** (Map<string, OmadaDevice>): Main state store
- Populated by `refreshDevices()` every 5 seconds
- Keyed by device MAC address
- Contains full device objects with port arrays

**Session Tokens**:
- CSRF token stored in OmadaClient
- Auto-refreshed on 401 errors via retry logic in API methods
- Token set as axios default header: `Csrf-Token`

### Omada API Implementation

**Authentication Flow:**
1. GET `/api/info` → extract controllerId
2. POST `/{controllerId}/api/v2/login` → get CSRF token
3. All subsequent requests include token in headers

**PoE Control:**
- Switches: PATCH `/{controllerId}/api/v2/sites/{site}/switches/{mac}/ports/{port}`
- Gateways: PATCH `/{controllerId}/api/v2/sites/{site}/gateways/{mac}/ports/{port}`
- `updatePortPoe()` auto-detects device type from cache

**Port Status:**
- Retrieved via GET `/{controllerId}/api/v2/sites/{site}/devices`
- PoE state checked as: `port.poe === true || port.poe_mode === 'enabled'`

### Critical Details

**Polling Strategy:**
- Feedbacks require real-time state → 5-second polling interval
- Polling errors logged but don't trigger reconnect immediately
- Only initial connection failures trigger 30-second reconnect cycle

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
**Actions**: Async callbacks, must call `parseVariablesInString()` for variable support
**Feedbacks**: Boolean type returns true/false for styling, polled via `checkFeedbacks()`
**Instance Status**: Use InstanceStatus enum (Ok, ConnectionFailure, BadConfig, etc.)

## Omada Controller Requirements

- Local account required (cloud accounts don't support API)
- 2FA must be disabled for API user
- SSL verification often disabled due to self-signed certs on OC200/OC300
- Web API v2 used (NOT Open API - has daily limits)
- Compatible with controller versions 5.5.7 - 5.12.x+
