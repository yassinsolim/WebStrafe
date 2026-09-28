# Movement against CS2

An audit of WebStrafe's movement against Counter-Strike 2's published values,
done 2026-09-27 on `knives/move`. CS2 doesn't run on the Mac this was done on,
so every number comes from Valve's shipped data, Valve's public Source SDK
code, or community measurements, never from playing.

Units: the game runs in metres. 1 Source unit (u) = 1 inch = 0.0254 m, so
250 u/s = 6.35 m/s and 800 u/s² = 20.32 m/s². `METRES_PER_UNIT` in
`src/movement/cvars.ts` holds the factor, and the cvars are written as
`800 * U` so the CS2 value stays readable.

## Every constant

"Before" is the value on `knives/move` before this audit, "after" is what ships
now. Values in brackets are the same number in units, for comparison.

| Constant | CS2 (units) | Before (m) | After (m) | Source |
|---|---|---|---|---|
| `sv_gravity` | 800 u/s² | 19.0 m/s² [748] | **20.32 m/s²** | [convars.txt L11160][cv-gravity] |
| `sv_jump_impulse` | 301.99338 u/s, "sqrt(2\*gravity\*height)" | 5.4 m/s [212.6] | **7.6706 m/s** | [convars.txt L11247][cv-jump] |
| Jump height (feet at the apex) | 57 u (301.99² / 1600) | 0.746 m [29.4] | **1.4477 m [57.0]** | derived from the impulse; [VDC reachable heights][vdc-ref] |
| Air time of a flat jump | 0.755 s (2 × 301.99 / 800) | 0.547 s (70 ticks) | **0.750 s (96 ticks)** | derived |
| Gravity integration | half before the move, half after | all of it before the move | **half and half** | [StartGravity L1246][sdk-startgrav], [FinishGravity L1682][sdk-finishgrav] |
| Crouch jump height | 66 u (57 + 9) | 1.19 m [46.9] | **1.6763 m [66.0]** | [VDC reachable heights][vdc-ref], [reddit cl_showpos][reddit-cj], [zer0k-z][zer0k] |
| Feet lift when ducking in the air | 9 u | 0.44 m [17.3] | **0.2286 m [9]** | [VDC reachable heights][vdc-ref], [zer0k-z crouchbug][zer0k] |
| `sv_accelerate` | 5.5 | 13.0 | **5.5** | [convars.txt L10746][cv-accel] |
| `sv_friction` | 5.2 | 5.2 | 5.2 | [convars.txt L11142][cv-friction] |
| `sv_stopspeed` | 80 u/s | 2.4 m/s [94.5] | **2.032 m/s** | [convars.txt L11832][cv-stopspeed] |
| `sv_maxspeed` | 320 u/s | 9.5 m/s [374] | **8.128 m/s** | [convars.txt L11376][cv-maxspeed] |
| Ground speed clamp after accelerate | none, only wishspeed is clamped | clamped to `sv_maxspeed` | **none** | [WalkMove L1949][sdk-walkmove] |
| `sv_airaccelerate`, default | 12 | 150 | 150 (design call) | [convars.txt L10761][cv-airaccel] |
| `sv_airaccelerate`, bhop map | 1000 on autobhop servers | 150 | **1000** | [SharpTimer bhop][st-bhop], [shavit styles][shavit] |
| `sv_airaccelerate`, surf map | 150 on surf servers | 100 | **150** | [SharpTimer surf][st-surf], [rcnoob surf.cfg][rcnoob], [F-O-G][fog] |
| `sv_air_max_wishspeed` | 30 u/s | 0.762 m/s | 0.762 m/s | [convars.txt L10758][cv-airwish], [GetAirSpeedCap][sdk-aircap] |
| Knife run speed | 250 u/s | 9.5 m/s (every weapon ran at `sv_maxspeed`) | **6.35 m/s** | [weapons.vdata L16974][vd-knife] |
| Deagle run speed | 230 u/s | 9.5 m/s | **5.842 m/s** | [weapons.vdata L12710][vd-deagle] |
| AWP run speed | 200 u/s | 9.5 m/s | **5.08 m/s** | [weapons.vdata L13505][vd-awp] |
| AWP scoped run speed | 100 u/s | 9.5 m/s | **2.54 m/s** | [weapons.vdata L13505][vd-awp], [2015 nerf][awp-nerf] |
| Crouch-walk speed | 0.34 × run speed (knife 85 u/s, scoped AWP 34) | 0.34 × 9.5 = 3.23 m/s | 0.34 × weapon: **2.159** knife, 1.986 Deagle, 1.727 AWP, 0.864 scoped | [CS wiki AWP][wiki-awp], [Steam speed guide][steam-speed] |
| Walk speed (shift) | 0.52 × run speed (knife 130 u/s) | no walk key | no walk key (not present) | [Steam speed guide][steam-speed], [CS wiki AWP][wiki-awp] |
| Standing hull height | 72 u | 1.76 m [69.3] | **1.8288 m** | [VDC player dimensions][vdc-ref] |
| Crouched hull height | 54 u | 1.32 m [52.0] | **1.3716 m** | [VDC player dimensions][vdc-ref] |
| Standing eye height | 64 u (VDC measures 64.09 above the ground, feet float 0.03) | 1.6 m [63.0] | **1.6256 m** | [VDC player dimensions][vdc-ref] |
| Crouched eye height | 46 u (46.08 measured) | 1.12 m [44.1] | **1.1684 m** | [VDC player dimensions][vdc-ref] |
| Hull width | 32 u box (16 u = 0.4064 m half-width) | capsule, radius 0.34 m | 0.34 m (design call) | [VDC player dimensions][vdc-ref] |
| Duck time on the ground | `m_flDuckSpeed` defaults to 8, read as 1/8 s | 0.12 s | 0.12 s | [AlliedModders][am-duck], [schema][schema-move] |
| Walkable slope | `sv_standable_normal` 0.7 = 45.57° | 39.5° (then surf from 40°) | 39.5° (known gap) | [convars.txt L11805][cv-standable], [VDC][vdc-ref] |
| Step-up height | `sv_stepsize` 18 u | none (0.08 m snap down only) | none (known gap) | [convars.txt L11829][cv-stepsize] |
| `sv_enablebunnyhopping` | false: jump speed capped at 1.1 × max speed | no cap | no cap (community value) | [convars.txt L11061][cv-enablebhop] |
| `sv_autobunnyhopping` | false | on | on (kept, decided 2026-09-27) | [convars.txt L10818][cv-autobhop] |
| Landing slowdown | stamina before 2026; since Jan 2026 a function of landing time and vertical landing speed | none | none (community value) | [HLTV patch notes][hltv-jump], [CS2NEWS][cs2news-land], [convars.txt L11289][cv-legacy] |
| Bhop press window | `sv_bhop_time_window` 1/128 s around the landing | the landing tick (1/128 s) | same | [convars.txt L10836][cv-bhopwindow] |
| Tick rate | 64 tick plus subtick | 128 Hz | 128 Hz | [zer0k-z airstrafe][zer0k] |

## Design calls

- **`sv_airaccelerate` default stays 150, not CS2's 12.** Maps without cvars
  (the aim arena, the practice range, custom maps) get it. WebStrafe is a
  movement game with autobhop on everywhere, so the default matches a surf
  server rather than matchmaking. With the 30 u/s cap, any value past about 15
  at knife speed gives the same perfect-strafe gain; the value only decides
  how hard wrong inputs and sharp turns hit.
- **Bhop map 1000, surf map 150.** These are what community timers ship:
  poor-sharptimer's `bhop_` exec sets 1000 and its `surf_` exec 150, shavit's
  default autobhop style is 1000 (its scroll style is 100), and surf guides
  call 150 the standard. The old 150 and 100 were each other's values.
- **No stamina, no 1.1× jump cap, autobhop on.** That is a community bhop or
  surf server (`sv_enablebunnyhopping 1`, `sv_autobunnyhopping 1`, stamina
  costs 0), not matchmaking.
- **Every jump is the exact parabola.** Source's
  [CheckJumpButton][sdk-jump] sets the impulse when you're ducked (`=`) but
  adds it on top of StartGravity's half step when you stand (`+=`), so a
  standing jump peaks v·dt/2 lower. That matches VDC's CS:GO numbers: 55 u
  blocks standing and 57 u from a crouch at 128 tick. In CS2 a crouch jump
  reads 66 u (57 + 9), so its jumps reach the full 57 u, and ours do too,
  standing or crouched.
- **The air duck shrinks the hull about its middle.** Source 2013's
  `FinishDuck` lifts the feet by the whole hull difference (HL2's big crouch
  jump), which is what WebStrafe copied. CS lifts them 9 u: VDC's reachable
  heights go 55 → 64 u for jump then crouch, and zer0k-z's crouchbug only works
  9 to 11 u above the floor. The hull switch stays instant in the air (the
  crouchbug needs that). Moving the feet 9 u would make the camera jump 23 cm,
  so the camera keeps its height on the switch and eases to the new eye height
  at the ground duck rate (`viewEase`, ours).
- **The crouch crop lowers the goal speed, not the accel rate.** CS2 has
  `sv_accelerate_use_weapon_speed 1` and no public formula. With CS2's accel
  5.5, friction 5.2 and stopspeed 80, a rate cropped along with the goal can't
  beat friction under 80 × 5.2 / 5.5 = 76 u/s, so the Deagle, AWP and scoped
  AWP could never reach their measured 78, 68 and 34 u/s crouch-walks. Ground
  accel keeps the uncropped wishspeed as its rate, and every crouch speed in
  the table is reached exactly.
- **The capsule radius stays 0.34 m.** CS2's hull is a 32 u box. A capsule
  can't match it, and widening it would change every map's clearances.
- **Hit geometry is separate from the movement hull.** `CombatArena` keeps its
  1.76 m hit capsule and 1.6 m authority eye, which follow the character model.
  The 2.6 cm eye difference sits far inside the 1 m (melee) and 3 m (gun)
  origin tolerances.
- **Bots run at Deagle speed.** `BotManager` and `HostSimulation` arm bots with
  the Deagle, so `BotController` caps them at 230 u/s like a player holding one.

## How the weapon speed is wired

- `WeaponDef.maxSpeed` and `scopedMaxSpeed` in `src/combat/weapons.ts` hold the
  vdata values, and `weaponMaxSpeed(id, scoped)` picks one.
- `MovementController.setMaxSpeedCap(speed)` clamps wishspeed to
  `min(sv_maxspeed, cap)`, like CS's per-player max speed on top of
  `sv_maxspeed`. `getMaxSpeed()` reads it back. It's an input the owner keeps
  current, so it isn't in `MovementSnapshot` and `reset()` keeps it.
- `GameApp` (two edits, both commented):
  1. Right before each fixed-step `movement.tick`, it calls
     `setMaxSpeedCap(weaponMaxSpeed(this.weapon.getActive(), this.combatAim.isScoped()))`.
     Outside combat the active weapon is always the knife.
  2. `tickCombatAim` passes `movement.getMaxSpeed()` as the inaccuracy's
     `maxSpeed` instead of `sv_maxspeed`, because CS measures the move
     inaccuracy against the held weapon's own speed. Without it the AWP could
     never reach full move inaccuracy at 200 u/s against a 320 u/s reference.
- Switching weapons or scoping in while running doesn't snap your speed: the
  lower cap only lowers wishspeed, and friction takes the AWP from 200 to
  100 u/s in about 0.13 s, like CS.

## Measured

Flat ground, 128 Hz, the real `MovementController`.

| | Knife | Deagle | AWP | AWP scoped |
|---|---|---|---|---|
| Run speed | 6.35 m/s | 5.842 m/s | 5.08 m/s | 2.54 m/s |
| 90% of it from a standstill | 0.375 s | 0.375 s | 0.383 s | 0.672 s |
| Stop from full speed, no input | 0.414 s | 0.398 s | 0.367 s | 0.234 s |

The old values reached 90% of 9.5 m/s in 0.086 s and stopped in 0.453 s.

- A standing jump peaks at 1.4477 m (56.998 u; tick sampling costs 0.002 u)
  and lands on tick 96. A crouch jump peaks at 1.6763 m (65.998 u).
- Perfect strafing from knife speed with autobhop (view on the velocity
  heading every tick): 6.35, 9.80, 12.32, 14.41, 16.23, … 24.45 m/s after 10
  jumps, which is sqrt(6.35² + 960 × 0.762²). Each air tick adds W² to v², and
  a jump now has 96 of them instead of 70.
- A landing at 12 m/s without a jump loses exactly one tick of friction per
  tick (12 × (1 - 5.2/128) on the first) and is back to knife speed after
  about ten ticks.
- The best possible ground strafe tops out 2.8% over wishspeed at any speed
  (6.53 m/s with the knife, 8.35 m/s at `sv_maxspeed`), so dropping the ground
  clamp can't run away. With the old accel of 13 it would have reached about
  15 m/s.

## Not modelled

- **Walk (shift).** There is no walk key; Shift only speeds up the debug
  freecam. CS2 walks at 0.52 × the run speed if one is added.
- **Air surface friction.** Source multiplies air accel by 0.25 while you
  rise slower than 140 u/s ([CategorizePosition L3876][sdk-catpos], zer0k-z's
  "deadstrafing"). At our 150 to 1000 air accel the 30 u/s cap would still win
  for every weapon except a scoped AWP at 150 (0.74 against 0.76 m/s per
  tick), so perfect strafes are the same; weak inputs near the apex are
  stronger here.
- **Walkable slope and step-up.** WebStrafe treats 40° and up as surf and has
  no 18 u step-up, where CS2 walks up to 45.57° and steps 18 u. Both change
  which geometry is ground on every map, so they need their own pass.
- **Duck spam and `sv_timebetweenducks` 0.4 s**, the jump spam window, water,
  ladders and the landing view punch.
- **Tick rate.** CS2 runs 64 tick with subtick input, so it gets 48 air ticks
  per jump where WebStrafe gets 96, and strafing gains about half as much v²
  per jump there. WebStrafe matches CS:GO's 128-tick community servers.

## Follow-ups outside movement

- `ViewmodelRenderer` scales walk bob by `speed / 8`, tuned for 9.5 m/s. At the
  6.35 m/s knife run the bob sits at 79% of full.
- The viewmodel landing dip fires when you land faster than 6 m/s downwards,
  and a normal jump now lands at 7.67 m/s, so every jump dips. CS2 has a land
  dip too (`weapon_land_dip_amt`), so this may be fine as is.

## Tests

- `src/movement/__tests__/Cs2Values.test.ts` pins every changed value: the
  cvars, the 57 u jump and 96-tick air time, the 66 u crouch jump, the stop
  from under `sv_stopspeed`, friction on a fast landing, the ground strafe
  bound, hull and eye heights, the camera ease, and each weapon's run and
  crouch-walk speed.
- `src/combat/__tests__/weapons.test.ts` checks the vdata speeds and the scope
  rule.
- `src/world/__tests__/BuiltMaps.test.ts` runs the bhop course and every surf
  stage at knife speed with each map's shipped cvars.

## Sources

- SteamTracking/GameTracking-CS2 `DumpSource2/convars.txt` at
  [3fc98e7][cv] (2026-09-25, the newest commit on 2026-09-27).
- SteamTracking/GameTracking-CS2 `game/csgo/pak01_dir/scripts/weapons.vdata`
  at [3fc98e7][vd], byte-identical to `10f3693`, the commit
  `docs/COMBAT_DESIGN.md` cites.
- Valve Developer Community,
  [Counter-Strike: Global Offensive/Mapper's Reference][vdc-ref-live]
  (the [Dimensions][vdc-dim] page points CS2 at it too). The live site is
  behind a bot check, so the numbers were read from the
  [2026-09-18 archive copy][vdc-ref].
- ValveSoftware/source-sdk-2013 `src/game/shared/gamemovement.cpp` at
  [b8cfb12][sdk]: [Accelerate][sdk-accel], [AirAccelerate][sdk-airaccel],
  [Friction][sdk-friction], [WalkMove][sdk-walkmove],
  [FinishDuck][sdk-finishduck], [CategorizePosition][sdk-catpos].
- zer0k-z, [cs2-movement-issues][zer0k] (CS2KZ developer): crouchbug height,
  66 u blocks, deadstrafing, 64-tick airstrafe.
- Letaryat/poor-sharptimer map execs at 8c9f796: [bhop][st-bhop],
  [surf][st-surf], [vanilla][st-vnl].
- shavitush/bhoptimer [`shavit-styles.cfg`][shavit] at fe981a5.
- [rcnoob/cs-cfg surf.cfg][rcnoob] and the [F-O-G airaccelerate thread][fog].
- [Counter-Strike Wiki, AWP][wiki-awp] (CS2 and CS:GO speed table) and the
  [Steam weapon movement speed guide][steam-speed].
- [HLTV, CS2 update notes, January 2026][hltv-jump] (jump and landing rework).
- AWP scoped speed 150 → 100 in the 2015-03-31 update:
  [Steam discussion quoting Valve's notes][awp-nerf].
- [AlliedModders, default duck speed 8][am-duck] and the
  [`CCSPlayer_MovementServices` schema][schema-move].
- [r/counterstrike2, crouch jump reads 66 with cl_showpos][reddit-cj].

[cv]: https://github.com/SteamTracking/GameTracking-CS2/blob/3fc98e763328f7d1627405b389d1b6b69c5b0e38/DumpSource2/convars.txt
[cv-accel]: https://github.com/SteamTracking/GameTracking-CS2/blob/3fc98e763328f7d1627405b389d1b6b69c5b0e38/DumpSource2/convars.txt#L10746
[cv-airwish]: https://github.com/SteamTracking/GameTracking-CS2/blob/3fc98e763328f7d1627405b389d1b6b69c5b0e38/DumpSource2/convars.txt#L10758
[cv-airaccel]: https://github.com/SteamTracking/GameTracking-CS2/blob/3fc98e763328f7d1627405b389d1b6b69c5b0e38/DumpSource2/convars.txt#L10761
[cv-autobhop]: https://github.com/SteamTracking/GameTracking-CS2/blob/3fc98e763328f7d1627405b389d1b6b69c5b0e38/DumpSource2/convars.txt#L10818
[cv-bhopwindow]: https://github.com/SteamTracking/GameTracking-CS2/blob/3fc98e763328f7d1627405b389d1b6b69c5b0e38/DumpSource2/convars.txt#L10836
[cv-enablebhop]: https://github.com/SteamTracking/GameTracking-CS2/blob/3fc98e763328f7d1627405b389d1b6b69c5b0e38/DumpSource2/convars.txt#L11061
[cv-friction]: https://github.com/SteamTracking/GameTracking-CS2/blob/3fc98e763328f7d1627405b389d1b6b69c5b0e38/DumpSource2/convars.txt#L11142
[cv-gravity]: https://github.com/SteamTracking/GameTracking-CS2/blob/3fc98e763328f7d1627405b389d1b6b69c5b0e38/DumpSource2/convars.txt#L11160
[cv-jump]: https://github.com/SteamTracking/GameTracking-CS2/blob/3fc98e763328f7d1627405b389d1b6b69c5b0e38/DumpSource2/convars.txt#L11247
[cv-legacy]: https://github.com/SteamTracking/GameTracking-CS2/blob/3fc98e763328f7d1627405b389d1b6b69c5b0e38/DumpSource2/convars.txt#L11289
[cv-maxspeed]: https://github.com/SteamTracking/GameTracking-CS2/blob/3fc98e763328f7d1627405b389d1b6b69c5b0e38/DumpSource2/convars.txt#L11376
[cv-standable]: https://github.com/SteamTracking/GameTracking-CS2/blob/3fc98e763328f7d1627405b389d1b6b69c5b0e38/DumpSource2/convars.txt#L11805
[cv-stepsize]: https://github.com/SteamTracking/GameTracking-CS2/blob/3fc98e763328f7d1627405b389d1b6b69c5b0e38/DumpSource2/convars.txt#L11829
[cv-stopspeed]: https://github.com/SteamTracking/GameTracking-CS2/blob/3fc98e763328f7d1627405b389d1b6b69c5b0e38/DumpSource2/convars.txt#L11832
[vd]: https://github.com/SteamTracking/GameTracking-CS2/blob/3fc98e763328f7d1627405b389d1b6b69c5b0e38/game/csgo/pak01_dir/scripts/weapons.vdata
[vd-deagle]: https://github.com/SteamTracking/GameTracking-CS2/blob/3fc98e763328f7d1627405b389d1b6b69c5b0e38/game/csgo/pak01_dir/scripts/weapons.vdata#L12710
[vd-awp]: https://github.com/SteamTracking/GameTracking-CS2/blob/3fc98e763328f7d1627405b389d1b6b69c5b0e38/game/csgo/pak01_dir/scripts/weapons.vdata#L13505
[vd-knife]: https://github.com/SteamTracking/GameTracking-CS2/blob/3fc98e763328f7d1627405b389d1b6b69c5b0e38/game/csgo/pak01_dir/scripts/weapons.vdata#L16974
[schema-move]: https://github.com/SteamTracking/GameTracking-CS2/blob/3fc98e763328f7d1627405b389d1b6b69c5b0e38/DumpSource2/schemas/server/CCSPlayer_MovementServices.h
[vdc-ref-live]: https://developer.valvesoftware.com/wiki/Counter-Strike:_Global_Offensive/Mapper%27s_Reference
[vdc-ref]: http://web.archive.org/web/20260918191627/https://developer.valvesoftware.com/wiki/Counter-Strike:_Global_Offensive/Mapper%27s_Reference
[vdc-dim]: http://web.archive.org/web/20260918191714/https://developer.valvesoftware.com/wiki/Dimensions
[sdk]: https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/shared/gamemovement.cpp
[sdk-startgrav]: https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/shared/gamemovement.cpp#L1246-L1265
[sdk-finishgrav]: https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/shared/gamemovement.cpp#L1682-L1698
[sdk-friction]: https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/shared/gamemovement.cpp#L1610-L1660
[sdk-airaccel]: https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/shared/gamemovement.cpp#L1705-L1745
[sdk-accel]: https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/shared/gamemovement.cpp#L1820-L1850
[sdk-walkmove]: https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/shared/gamemovement.cpp#L1946-L1960
[sdk-catpos]: https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/shared/gamemovement.cpp#L3862-L3877
[sdk-finishduck]: https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/shared/gamemovement.cpp#L4215-L4250
[sdk-jump]: https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/shared/gamemovement.cpp#L2447-L2463
[sdk-aircap]: https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/shared/gamemovement.h#L104
[zer0k]: https://github.com/zer0k-z/cs2-movement-issues/blob/main/readme.md
[st-bhop]: https://github.com/Letaryat/poor-sharptimer/blob/8c9f7968ac48ec464bb83c2908d6d4436ce81fc8/cfg/SharpTimer/MapData/MapExecs/example.bhop_.cfg
[st-surf]: https://github.com/Letaryat/poor-sharptimer/blob/8c9f7968ac48ec464bb83c2908d6d4436ce81fc8/cfg/SharpTimer/MapData/MapExecs/example.surf_.cfg
[st-vnl]: https://github.com/Letaryat/poor-sharptimer/blob/8c9f7968ac48ec464bb83c2908d6d4436ce81fc8/cfg/SharpTimer/MapData/MapExecs/example.vnl_.cfg
[shavit]: https://github.com/shavitush/bhoptimer/blob/fe981a5098215e23b76b218bd37d9101ac6d9571/addons/sourcemod/configs/shavit-styles.cfg
[rcnoob]: https://github.com/rcnoob/cs-cfg/blob/main/surf.cfg
[fog]: https://forums.f-o-g.eu/threads/airaccelerate-on-csgo-bhop.12554/
[wiki-awp]: https://counterstrike.fandom.com/wiki/AWP
[steam-speed]: https://steamcommunity.com/sharedfiles/filedetails/?id=252239282
[hltv-jump]: https://www.hltv.org/news/43689/anubis-mp7-and-mp5-sd-receive-changes-in-latest-cs2-update
[cs2news-land]: https://cs2news.com/news/counter-strike-2-update-changes-landing-speed-mechanics
[awp-nerf]: https://steamcommunity.com/app/730/discussions/0/412446890551139338/
[am-duck]: https://forums.alliedmods.net/showthread.php?t=289413
[reddit-cj]: https://www.reddit.com/r/counterstrike2/comments/1pu5vnm/a_question_about_crouch_jumping/
