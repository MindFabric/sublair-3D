# Sketchbook Development Log

## Character Customization System

### Features Implemented
- **Little Big Planet-style customization menu**
  - Color picker with 18 preset colors
  - Texture system with 8 patterns (solid, stripes, dots, checker, grid, diagonal, waves, stars)
  - Fine-tuning controls:
    - Scale slider (0.1 - 5.0)
    - Rotation slider (0° - 360°)
    - Density slider (0.5 - 3.0)

### Menu Positioning
- Menu positioned on the right side of screen (`right: 30px`)
- Dark sleek styling with blur effects
- Smooth animations on open/close

### Controls
- **C key** - Toggle customization menu
- **ESC key** - Close customization menu
- **Customize button** - Bottom-right button to open/close menu

### Opening Behavior
1. Set character velocity target to zero
2. Character naturally decelerates to stop
3. Once stopped (velocity < 0.1):
   - Disable WASD controls via dummy input receiver
   - Fully stop character movement
   - Save current camera position
   - Move camera to front of character (relative to character rotation)
   - Unlock mouse cursor (exit pointer lock)
   - Show customization menu

### Closing Behavior
1. Hide menu
2. Restore saved camera position
3. Re-enable character controls
4. Re-lock mouse pointer for game controls

## Computer Terminal Interaction

### Features
- **Proximity-based interaction**
  - Shows prompt "Press F to use computer" when within 3 units
  - Computer located at position (-5, 0.75, 5)

### Terminal Login Screen
- **Styling**: Dark background with #bee17b accent color
- **Header**: "SUBLAIR LOGIN SCREEN"
- **Credentials**:
  - Username: `admin`
  - Password: `password`
- **Controls**: Login button, Cancel button, Enter key to submit

### Terminal Interaction Flow
1. Character approaches computer (distance < 3)
2. Press F to open terminal
3. Disable WASD controls via dummy input receiver
4. Unlock mouse cursor for typing
5. Enter credentials
6. On success/cancel:
   - Re-enable character controls
   - Re-lock mouse pointer
   - Show success message (on login)

## Technical Implementation

### Dummy Input Receiver Pattern
Created a global dummy input receiver to disable character controls without causing null reference errors:

```javascript
const dummyInputReceiver = {
    handleKeyboardEvent: () => {},
    handleMouseButton: () => {},
    handleMouseMove: () => {},
    handleMouseWheel: () => {},
    inputReceiverInit: () => {},
    inputReceiverUpdate: () => {}
};
```

**Usage**:
- Disable controls: `world.inputManager.inputReceiver = dummyInputReceiver;`
- Enable controls: `character.takeControl();`

### Camera Positioning
- Camera positions relative to character rotation using `character.rotation.y`
- Saved camera state: `theta`, `phi`, `radius`
- Customization view: Front facing with `theta = character.rotation.y`, `phi = 10`, `radius = 2.5`

### Pointer Lock Management
- Exit pointer lock: `document.exitPointerLock();`
- Request pointer lock: `world.renderer.domElement.requestPointerLock();`
- Used for transitioning between game controls and UI interaction

### Procedural Texture Generation
Textures generated using Canvas API with adjustable density parameter:
- Density affects spacing between pattern elements
- Textures support scale and rotation transformations
- Applied to character materials via Three.js CanvasTexture

## Global State Variables
- `character` - Character reference
- `customizationOpen` - Boolean flag for customization menu state
- `terminalOpen` - Boolean flag for terminal menu state
- `isOpeningCustomization` - Flag to prevent double-opening during deceleration
- `dummyInputReceiver` - Shared input receiver for disabling controls

## File Modified
- `simple-car.html` - Main game file with all customization and terminal systems
