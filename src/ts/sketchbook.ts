import '../css/main.css';
import * as THREE from 'three';
import * as CANNON from 'cannon';
import Swal from 'sweetalert2';
import * as GUI from '../lib/utils/dat.gui';

// Expose THREE, CANNON, Swal, and GUI globally
if (typeof window !== 'undefined') {
	(window as any).THREE = THREE;
	(window as any).CANNON = CANNON;
	(window as any).Swal = Swal;
	(window as any).GUI = GUI;
}

export { World } from './world/World';
export { Character } from './characters/Character';
export { Car } from './vehicles/Car';
export { Airplane } from './vehicles/Airplane';
export { Helicopter } from './vehicles/Helicopter';
export { LoadingManager } from './core/LoadingManager';
export { UIManager } from './core/UIManager';