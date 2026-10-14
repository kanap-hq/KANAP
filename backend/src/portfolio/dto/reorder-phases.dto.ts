import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';

/** Upper bound of the phase list sent to reorder a project's phases. */
export const PHASE_REORDER_MAX_IDS = 500;

/** Body of `POST /portfolio/projects/:id/phases/reorder`: the project's phase ids in their new order. */
export class ReorderPhasesDto {
  @IsArray()
  @ArrayMaxSize(PHASE_REORDER_MAX_IDS)
  @IsUUID('all', { each: true })
  phase_ids!: string[];
}
