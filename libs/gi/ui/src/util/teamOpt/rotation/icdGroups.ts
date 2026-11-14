/*
 * ICD groups: reset time (frames) and element application pattern (1 = applies), from gcsim
 * (pkg/core/attacks/icd_groups.dm.go, AGPLv3; this project is AGPLv3 too). Generated: do not edit.
 */
export const icdGroups: Record<string, { reset: number; apply: number[] }> = {
  Default: {
    reset: 150,
    apply: [
      1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
    ],
  },
  PoleExtraAttack: {
    reset: 30,
    apply: [
      1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
  },
  ReactionA: { reset: 30, apply: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1] },
  ReactionB: { reset: 30, apply: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1] },
  Burning: { reset: 120, apply: [1, 0, 0, 0, 0, 0, 0, 0] },
  AinoBurstMoonHit: { reset: 108, apply: [1, 0, 0, 0] },
  AlhaithamExtraAttack: {
    reset: 120,
    apply: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  AlhaithamProjectionAttack: {
    reset: 720,
    apply: [
      1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0,
    ],
  },
  AlyoshaBurst: { reset: 96, apply: [1, 0] },
  // KQM-git/kqmsim 7bdf45f, pkg/core/attacks/icd_groups.dm.go
  AnastasyaSkill: { reset: 96, apply: [1, 0] },
  VesnaSkill: { reset: 120, apply: [1, 0] },
  ValeriyBurst: { reset: 120, apply: [1, 0] },
  Amber: {
    reset: 60,
    apply: [
      1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
    ],
  },
  ArlecchinoElementalArt: {
    reset: 600,
    apply: [1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  AyakaExtraAttack: {
    reset: 30,
    apply: [
      1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0,
    ],
  },
  BaizhuC2: { reset: 240, apply: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  CharlotteKamera: { reset: 240, apply: [1, 0, 0, 0, 1, 0, 0, 0] },
  CharlotteMark: { reset: 720, apply: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0] },
  ChascaBurst: { reset: 90, apply: [1, 0, 1, 0, 1, 0] },
  ChascaShadowhunt: { reset: 90, apply: [1, 0] },
  ChascaShining: { reset: 90, apply: [1, 0, 1, 0, 1, 0] },
  ChascaTap: { reset: 90, apply: [1, 0] },
  ChevreuseBurstMines: { reset: 180, apply: [1, 0, 0, 1, 0, 0, 0, 0] },
  ChioriSkill: { reset: 114, apply: [1, 0, 0, 0, 0] },
  CitlaliFrostfallStorm: { reset: 90, apply: [1, 0] },
  ClorindeElementalArt: {
    reset: 60,
    apply: [
      1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
  },
  ColleiBurst: { reset: 180, apply: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  CynoBolt: { reset: 150, apply: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  Diluc: {
    reset: 300,
    apply: [
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0,
      1, 0, 0, 0, 0,
    ],
  },
  DoriBurst: { reset: 180, apply: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  DurinBurstBlack: { reset: 120, apply: [1, 0] },
  DurinBurstWhite: { reset: 90, apply: [1, 0] },
  DurinSkill: { reset: 18, apply: [1, 0, 0] },
  EmilieLumidouce: { reset: 120, apply: [1, 0] },
  EscoffierSkill: { reset: 90, apply: [1, 0, 0, 0, 0, 0] },
  Fischl: {
    reset: 300,
    apply: [
      1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1,
      0, 0, 0, 1, 0, 0, 0,
    ],
  },
  FurinaSalonSolitaire: {
    reset: 1800,
    apply: [
      1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0,
    ],
  },
  IfaSedationMark: { reset: 120, apply: [1, 0] },
  IfaSkillHit: {
    reset: 720,
    apply: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
  },
  JahodaBurst: {
    reset: 900,
    apply: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
  },
  JahodaCons: { reset: 900, apply: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0] },
  KinichLoopShot: { reset: 120, apply: [1, 0, 0, 0] },
  KinichScalespikerCannon: { reset: 72, apply: [1, 0, 0, 0] },
  LanyanRingAttack: {
    reset: 150,
    apply: [
      1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
    ],
  },
  LanyanRingAttackMix: {
    reset: 150,
    apply: [
      1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
    ],
  },
  Layla: { reset: 180, apply: [1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0] },
  LyneyExtra: { reset: 60, apply: [1, 0, 0, 0, 0, 0] },
  MizukiSkill: { reset: 72, apply: [1, 0, 0, 0] },
  NahidaSkill: { reset: 60, apply: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  NaviaBurst: {
    reset: 720,
    apply: [
      1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
    ],
  },
  Nilou: { reset: 114, apply: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0] },
  OdetteDanceDuo: { reset: 180, apply: [1, 0, 0, 0] },
  OroronElementalBurst: { reset: 180, apply: [1, 0, 0, 0, 0, 0, 0] },
  SandroneSweepingFire: { reset: 84, apply: [1, 0] },
  Sigewinne: { reset: 120, apply: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  SigewinneBurst: {
    reset: 114,
    apply: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  Tighnari: { reset: 150, apply: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0] },
  TravelerBurst: { reset: 480, apply: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0] },
  TravelerCryoIcicle: { reset: 150, apply: [1, 0, 0, 0] },
  TravelerDewdrop: { reset: 90, apply: [1, 0, 0, 0, 0, 0, 0, 0] },
  Venti: {
    reset: 60,
    apply: [
      1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
    ],
  },
  WandererA4: {
    reset: 60,
    apply: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  WandererC6: {
    reset: 120,
    apply: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  XiaoDash: { reset: 6, apply: [1, 0, 0, 0, 0, 0, 0] },
  YaeCharged: { reset: 30, apply: [1, 0, 0, 0, 0, 0, 0] },
  YaoyaoRadishBurst: { reset: 90, apply: [1, 0, 0, 0, 0, 0] },
  YaoyaoRadishSkill: { reset: 150, apply: [1, 0, 0, 0, 0, 0] },
  YelanBreakthrough: { reset: 18, apply: [1, 0, 0, 0] },
  YelanBurst: {
    reset: 120,
    apply: [
      1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
    ],
  },
}
