import
{
	CharacterStateBase,
	JumpIdle,
} from './_stateLibrary';
import { ICharacterState } from '../../interfaces/ICharacterState';
import { Character } from '../Character';

export class Falling extends CharacterStateBase implements ICharacterState
{
	constructor(character: Character)
	{
		super(character);

		this.character.velocitySimulator.mass = 100;
		this.character.rotationSimulator.damping = 0.3;

		this.character.arcadeVelocityIsAdditive = true;
		this.character.setArcadeVelocityInfluence(0.05, 0, 0.05);

		this.playAnimation('falling', 0.3);
	}

	public onInputChange(): void
	{
		super.onInputChange();

		// Allow wall jumping while falling in the air
		if (this.character.actions.jump.justPressed)
		{
			// If we can wall jump, transition to JumpIdle state to play jump animation
			if (this.character.canWallJump)
			{
				this.character.setState(new JumpIdle(this.character));
			}

			this.character.jump();
		}
	}

	public update(timeStep: number): void
	{
		super.update(timeStep);

		this.character.setCameraRelativeOrientationTarget();
		this.character.setArcadeVelocityTarget(this.anyDirection() ? 0.8 : 0);

		if (this.character.rayHasHit)
		{
			this.setAppropriateDropState();
		}
	}
}