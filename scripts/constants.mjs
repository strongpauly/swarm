export const MOD_NAME = "swarm";
export const SWARM_FLAG = "isSwarm";
export const SWARM_SIZE_FLAG = "swarmSize";
export const SWARM_SPEED_FLAG = "swarmSpeed";
export const SWARM_IMAGE_FLAG = "swarmImage";

export const ANIM_TYPE_FLAG = "animation";
export const ANIM_TYPE_CIRCULAR = "circular";
export const ANIM_TYPE_RAND_SQUARE = "random";
export const ANIM_TYPE_SPIRAL = "spiral";
export const ANIM_TYPE_SKITTER = "skitter";
export const ANIM_TYPE_STOPNMOVE = "move_stop_move";
export const ANIM_TYPE_FORMATION_SQUARE = "formation";
export const ANIM_TYPES = [
	ANIM_TYPE_CIRCULAR,
	ANIM_TYPE_RAND_SQUARE,
	ANIM_TYPE_SPIRAL,
	ANIM_TYPE_SKITTER,
	ANIM_TYPE_STOPNMOVE,
	ANIM_TYPE_FORMATION_SQUARE
];

export const SETTING_HP_REDUCE = "reduceSwarmWithHP";
export const SETTING_HP_REDUCE_ATTRIBUTE_VALUE = "attributeHpValue";
export const SETTING_HP_REDUCE_ATTRIBUTE_MAX = "attributeHpMax";
export const SETTING_FADE_TIME = "fadeTime";
export const SETTING_STOP_TIME = "stopTime";
export const SETTING_MIGRATED_TO = "migratedTo";
export const THETA = 0.01;
export const SIGMA = 5;
export const GAMMA = 1000;
export const DEFAULT_SWARM_SIZE = 20;
export const DEFAULT_SWARM_SPEED = 1;
export const DEFAULT_ANIMATION = ANIM_TYPE_CIRCULAR;
