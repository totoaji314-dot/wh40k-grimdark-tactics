# 에셋 목록 (ASSET_MANIFEST) — 2026-10-31 (4차 갱신: 홀리 테라 황궁 재구축)

방침(사용자 지시): 모델은 자체 제작 대신 여러 사이트에서 가장 좋은 모델을 가져온다 (맵 모델 포함).
원본 다운로드 파일은 저장소 밖 `D:\01_BoltgunReference\Downloaded_Assets\<사이트>\<모델>\`에 손대지 않고 보관하고, 게임용 변환본만 `public/assets/`에 둔다.
공개 빌드에는 CC0 / CC BY(출처 표시) / 비상업 허용 라이선스만 넣는다. 공식 게임에서 추출한 모델(리핑)은 업로더가 CC를 붙였어도 넣지 않는다.

## 1. 게임이 실제로 쓰는 모델

| 모델 | 출처 | 공개 빌드 | 비고 |
|---|---|---|---|
| **사진 스캔 소품 9종** — 아래 2절 | Poly Haven, CC0 | 포함 | `tools/build_props.mjs` → `public/assets/props/props.glb` 0.9 MB. 환경 키트의 상자·드럼통·바리케이드를 대체하고(충돌 범위 동일), 방어선·벙커·잔해 주변에 잡동사니 배치 |
| **홀리 테라 황궁 세트 (재구축)** — 아래 2-1절 | 직접 모델링 + SMK 퍼블릭 도메인 조각상 스캔 14점 + Smithsonian CC0 조각상 스캔 2점 + ambientCG CC0 텍스처 15종 | 포함 | `public/assets/terra/palace.glb` 11.2 MB, 홀리 테라 전장에서만 로드. 영원의 문·황궁 성벽·탑·옥좌의 전당·황금 옥좌·원경 첨탑, 성인상·기마상·황제 좌상, 순례자·서보 스컬·라이노·화로·깃발 |
| 홀리 테라 가로등·탐조등 2종 — 아래 2절 | Poly Haven, CC0 | 포함 | `public/assets/props/terra.glb` 0.19 MB (이전 3.1 MB 세트에서 성벽·탑·철문·사자 머리·쪽문·성인상·기마상을 뺌) |
| 스페이스 마린 4종, 카디안 5종, 크리그 3종, 오크 4종 | 자체 제작 (`tools/blender/factions.py`) | 포함 | **교체 대상** — 3절 후보로 바꾸려면 Sketchfab 로그인 필요 |
| 리만 러스 전차 | 자체 제작 (`tools/blender/vehicles.py`) | 포함 | **교체 대상** — 3절 후보 |
| 환경 키트 (건물·참호·드롭 포드·썬더볼트 등) | 자체 제작 (`tools/blender/env.py`) | 포함 | 건물은 **교체 대상** — 3절 후보 |
| Space Marine (2011) 레안드로스·시도누스, Havok 애니메이션 | 공식 게임 데모 추출 | **제외** | 재배포 권한 없음. 개발 서버 `/local-assets/`로만 로드 |

## 2. 내려받아 게임에 넣은 모델 (Poly Haven, 전부 CC0 — 로그인 없이 공식 API로 다운로드)

| 모델 | 제작자 | 원본 → 게임 삼각형 | 쓰임 |
|---|---|---|---|
| [Barrel_01](https://polyhaven.com/a/Barrel_01) (위험물 드럼통) | Jorge Camacho | 2,682 → 1,400 | 드럼통 더미 (4개 중 1개꼴) |
| [barrel_03](https://polyhaven.com/a/barrel_03) (강철 드럼통) | Serhii Khromov | 1,473 → 1,199 | 드럼통 더미 기본 |
| [concrete_road_barrier](https://polyhaven.com/a/concrete_road_barrier) | Amal Kumar | 60,928 → 1,600 | 바리케이드 (2개 한 조) |
| [concrete_road_barrier_02](https://polyhaven.com/a/concrete_road_barrier_02) | Amal Kumar | 23,822 → 1,600 | 바리케이드 변형 |
| [wooden_military_crate](https://polyhaven.com/a/wooden_military_crate) | Prabhjinder Singh | 22,986 → 2,398 | 보급 상자 더미 |
| [old_military_crate](https://polyhaven.com/a/old_military_crate) (탄약 상자) | Jack Mava | 10,476 → 1,611 | 상자 더미·잡동사니 |
| [metal_jerrycan](https://polyhaven.com/a/metal_jerrycan) | Sean Buckley | 20,022 → 898 | 잡동사니 |
| [old_tyre](https://polyhaven.com/a/old_tyre) | MP | 2,880 → 1,200 | 잡동사니 (눕힘·쌓음) |
| [rusted_wheel_rim_01](https://polyhaven.com/a/rusted_wheel_rim_01) | John Hutcheson | 16,440 → 1,099 | 잔해 주변 잡동사니 |

**홀리 테라 가로등·탐조등** (`public/assets/props/terra.glb` 0.19 MB, 홀리 테라 전장에서만 로드, `node tools/build_props.mjs terra`):

| 모델 | 제작자 | 원본 → 게임 삼각형 | 쓰임 |
|---|---|---|---|
| [street_lamp_01](https://polyhaven.com/a/street_lamp_01) | Josh Dean | 30,610 → 2,752 | 대로 가로등 (정문 앞 100 m까지) |
| [portable_searchlight](https://polyhaven.com/a/portable_searchlight) | Elijah Cragg | 18,802 → 2,198 | 벙커 위·방어선 탐조등 |

이전 3.1 MB 세트의 modular_fort_01(성벽·원형 탑), large_iron_gate, lion_head, large_castle_door, gothic_statue, horse_statue_01은 2-1절의 황궁 세트로 바뀌어 게임에서 빠졌다. 원본은 `Downloaded_Assets\polyhaven`에 그대로 있다.

## 2-1. 홀리 테라 황궁 세트 (`public/assets/terra/palace.glb` 11.2 MB + `palace.json`)

만드는 순서: `Holy_Terra_Asset_Acquisition_Kit`(저장소 밖)로 내려받기·분류·Blender 검사 → `tools/blender/terra_landmarks.py`(Blender 5.2, 코드로 모델링 + 조각상 스캔 감량, 조각마다 LOD 3단계) → `tools/build_palace.mjs`(텍스처 WebP 1K/512, 양자화, meshopt 압축). 원본 다운로드는 하나도 수정하지 않았다.

**직접 모델링 (이 저장소 코드, 공개 가능)** — 삼각형은 LOD0 / LOD1 / LOD2:

| 조각 | 크기 (폭×높이×깊이) | 삼각형 | 내용 |
|---|---|---|---|
| 영원의 문 (eternity_gate) | 80 × 101 × 35 m | 26,424 / 8,706 / 1,584 | 열린 청동 문짝 두 짝, 첨두 아치, 성인 벽감 4개, 아퀼라, 성문 탑 2개(첨탑·흉벽), 깃발·화로·보초 자리 |
| 황궁 성벽 (palace_wall) | 25.5 × 35 × 13.9 m | 1,751 / 785 / 222 | 버트레스·흉벽·순찰로, 깃발·보초 자리 |
| 황궁 탑 (palace_tower) | 24.8 × 77 × 24.8 m | 7,478 / 1,394 / 402 | 고딕 첨탑 탑 |
| 옥좌의 전당 (throne_hall) | 61.6 × 56.5 × 45.5 m | 9,220 / 3,550 / 323 | 정면이 열린 전당, 기둥·창·체크 바닥, 화로 6개·깃발 |
| 옥좌 단 (throne_dais) | 27.9 × 4.5 × 29.2 m | 764 / 332 / 156 | 팔각 계단 단, 화로 4개 |
| 황금 옥좌 (golden_throne) | 19.2 × 24.7 × 16.1 m | 4,203 / 2,055 / 694 | 금빛 후광 기둥·케이블·촛대, 좌상(SMK 모세 스캔, 금색)이 앉음 |
| 원경 첨탑·돔 (palace_spire_a / palace_dome_b) | 198 m / 121 m | 3,910 / 3,548 (LOD0) | 남쪽 지평선의 황궁 스카이라인 |
| 라이노 (rhino) | 4 × 3 × 7.5 m | 1,709 / 715 / 471 | 정문 앞 주차 장갑차 (장식, 움직이지 않음) |
| 깃발·화로·조각상 받침 | — | 1,325 / 276 / 655 (LOD0) | 붉은 아퀼라 깃발, 불붙는 화로, 받침대 |
| 순례자 2종·서보 스컬 | 1.4–1.8 m | 258–348 (LOD0) | 무릎 꿇은·선 순례자 24명, 궤도를 도는 서보 스컬 12개 |

보초 NPC 26명은 새 모델이 아니라 게임의 기존 리그 병사(마린·가드맨·크리그 중 로드된 것)에 대기 애니메이션을 붙여 성문·성벽 자리에 세운 것이다.

**조각상 스캔 (내려받아 1.4만 / 3,600 / 900 삼각형으로 감량)**:

| 게임 조각 | 원본 | 출처 · 권리 | 쓰임 |
|---|---|---|---|
| saint_peter | 성 베드로 (생질뒤가르 석고 주형) [KAS2906/8](https://open.smk.dk/artwork/image/KAS2906/8) | SMK 덴마크 국립미술관, 퍼블릭 도메인 (CC PDM 1.0) | 정문 벽감 |
| saint_james | 사도 소 야고보 [KAS2906/5](https://open.smk.dk/artwork/image/KAS2906/5) | SMK, PD | 정문 벽감 |
| saint_thomas | 사도 토마스 [KAS2906/4](https://open.smk.dk/artwork/image/KAS2906/4) | SMK, PD | 정문 벽감 |
| saint_bartholomew | 사도 바르톨로메오 [KAS2906/3](https://open.smk.dk/artwork/image/KAS2906/3) | SMK, PD | 정문 벽감 |
| saint_george | 성 게오르기우스 [KAS82](https://open.smk.dk/artwork/image/KAS82) | SMK, PD | 대로 |
| saint_kunigunde | 황후 쿠니군데 [KAS862](https://open.smk.dk/artwork/image/KAS862) | SMK, PD | 대로 |
| emperor_augustus | 프리마 포르타의 아우구스투스 [KAS65](https://open.smk.dk/artwork/image/KAS65) | SMK, PD | 대로 |
| athena_shield | 방패를 든 아테나 [KAS2128](https://open.smk.dk/artwork/image/KAS2128) | SMK, PD | 대로 (청동색) |
| victorious_soldier | 승리한 덴마크 병사 [KMS5032](https://open.smk.dk/artwork/image/KMS5032) | SMK, PD | 대로 (청동색) |
| seated_prophet | 모세 [KAS243](https://open.smk.dk/artwork/image/KAS243) | SMK, PD | 황금 옥좌의 좌상 (금색) |
| god_king | 아르테미시온의 포세이돈(제우스) [KAS2100](https://open.smk.dk/artwork/image/KAS2100) | SMK, PD | 대로 (청동색) |
| hero_heracles | 랜즈다운 헤라클레스 [KAS224](https://open.smk.dk/artwork/image/KAS224) | SMK, PD | 대로 |
| warrior_minerva | 미네르바 주스티니아니 [KAS255](https://open.smk.dk/artwork/image/KAS255) | SMK, PD | 대로 |
| hero_apollo | 벨베데레의 아폴론 [KAS353](https://open.smk.dk/artwork/image/KAS353) | SMK, PD | 대로 |
| emperor_enthroned | George Washington (Greenough, 1840) [3d.si.edu](https://3d.si.edu/object/3d_package:789cf90a-4387-4ac1-9e96-c7d6a7b9d26f) | Smithsonian 3D, CC0 | 광장 중앙 13 m 황제 좌상 (스캔 텍스처) |
| equestrian_commander | Andrew Jackson (아연 주조) [3d.si.edu](https://3d.si.edu/object/3d_package:80a9e13c-8e58-4b74-8482-63fd5ee197d8) | Smithsonian 3D, CC0 | 정문 앞 기마상 2개 (스캔 텍스처) |

SMK 원본은 석고 주형 스캔이라 텍스처가 없다. 게임에서는 대리석·청동·금 재질을 입혔다.

**타일 텍스처 (ambientCG, 전부 CC0, `https://ambientcg.com/view?id=<id>`)**: Bricks108A(석재), Bricks008(밝은 석재), Granite005A(어두운 석재), Marble012(대리석), Metal048A(금), Metal008(청동), MetalPlates006(철), RoofingTiles006(지붕), Fabric030(깃발 천), PavingStones126A(포장석), MetalPlates013(도장 철판), Fabric061(순례자 옷), Travertine009(뼈·상아), Tiles074(전당 바닥), Rust009(케이블). 원본 텍스처는 중립색으로 내보내고, 색조·채도는 게임이 재질별로 입힌다(`palace.json`의 `tints`, `src/world/Palace.ts`).

내려받았지만 황궁에 쓰지 않은 것 (원본 보관, 공개 빌드 미포함): ambientCG 14종(Marble006·016, Onyx015, Metal034·042A, PavingStones070·128·138, Tiles107·143, Bricks085·097, Concrete034, Rock030), Poly Haven 37종(`polyhaven_palace_decor` 16종·`palace_works` 17종·`battlefield` 중 4종 — 현대적이거나 실내 소품이라 전장 크기에 맞지 않음). 전체 목록과 Blender 검사 결과는 `D:\01_BoltgunReference\Holy_Terra_Asset_Acquisition_Kit\reports\`.

받았지만 쓰지 않은 것 (원본은 보관): Barrel_02(플라스틱 통, 현대적), propane_tank(가스통·로고), wooden_crate_02(장식 궤짝), street_lamp_02(벽걸이형), modular_industrial_pipes_01 — 화풍이 맞지 않거나 자리가 없음.

## 3. 다음 교체 후보 — Sketchfab (전부 "다운로드 가능", 라이선스·설명 확인함)

**막힌 이유: Sketchfab은 다운로드에 계정 로그인이 필요하다** (API 응답 `Authentication credentials were not provided`). 계정 로그인·비밀번호 입력은 내가 대신할 수 없다. 이번 세션 중에는 내장 브라우저의 정책 확인도 계속 실패해 로그인 상태를 확인하지 못했다.

| 슬롯 | 후보 (제작자) | 라이선스 | 면 수 | 판단 |
|---|---|---|---|---|
| 오크 | [Space ork (WH40k)](https://sketchfab.com/3d-models/space-ork-wh40k-1cdd6b35b5874407b428cb8d587601c6) (Northcliffe) | CC BY | 20k, 애니메이션 1 | 1순위 — 리깅된 게임용, 슈타 포함 |
| 오크 지휘관 | [Ork Warboss](https://sketchfab.com/3d-models/ork-warboss-1472dd3663f24567abcbfad666a4e3bd) (mike_sandoval) | CC BY | 468k | 고면수 조각 — 감량·리깅 필요 |
| 크리그 | [Death-korps-of-krieg-20](https://sketchfab.com/3d-models/death-korps-of-krieg-20-ba2ffbe33b8c41a780e3154c90849dde) (Kaiser-E) | CC BY | 58k | 1순위 — 리깅 필요 |
| 터미네이터 | [Red Hunters Cataphractii Terminator](https://sketchfab.com/3d-models/red-hunters-cataphractii-terminator-5d5f65723a74476593a68c8b4d0efcf6) (Reznov315) | CC BY | 45k | 사람 기본 골격에 맞춘 모델이라 게임 리그 이식이 쉬움 |
| 마린 | [Space_marine (Salamander)](https://sketchfab.com/3d-models/space-marine-2778db353cb34d23ae55fc4a4b974874) (Pixels2241) | CC BY | 390k | 고면수 — 감량·리깅 필요 |
| 마린 | [Space Marine Blood Angels 2](https://sketchfab.com/3d-models/space-marine-blood-angels-2-43e2fda1ca3a49338a9c00541863b4ef) (DarioVarzino) | CC BY | 84k | 후보 |
| 리만 러스 | [W40k Leman Russ Battle Tank v2](https://sketchfab.com/3d-models/w40k-leman-russ-battle-tank-v2-510940bfcd0d4f1ebaae95f65f9402ee) (Telcy.Durand) | CC BY | 112k | 1순위 — 포탑 분리 여부는 받아서 확인 |
| 리만 러스 | [Leman Russ](https://sketchfab.com/3d-models/leman-russ-cc982f933f9e4d0893cf54cfd9753bd0) (masta_) | CC BY | 609k | 고면수 |
| 키메라 | [Chimera](https://sketchfab.com/3d-models/chimera-3cc61d82c0d74a1ca852f8a442328820) (brcasius) | CC BY | 14k | 1순위 신규 차량 |
| 발키리 | [Imperial Guard Valkyrie](https://sketchfab.com/3d-models/imperial-guard-valkyrie-vtol-carrier-9b9d791638a84c5ba0f63b4488c5fec8) (Hosti16) | CC BY, 제작자가 자유 사용·배포·수정 명시 | 97k | 공중 지원 기체 교체 |
| 오크 차량 | [Grot Tank](https://sketchfab.com/3d-models/grot-tank-f3038d6d9b9b4ae491628c562cc6f762) (emelyarules) | CC BY | 86k | 오크 첫 차량 |
| 드롭 포드 | [Space Marine Drop Pod Open](https://sketchfab.com/3d-models/space-marine-drop-pod-open-0c7994abe4c943de9e47611a9d857d79) (tapsellry1) | CC BY | 10k | 착지 포드 교체 |
| 전장 잔해 | [Destroyed Land Raider](https://sketchfab.com/3d-models/destroyed-land-raider-8b381a54d12e4373884f7b2ca37cd7f7), [Destroyed Imperial Knight](https://sketchfab.com/3d-models/destroyed-imperial-knight-2014e8ed79cd4838ad0124ca60a60bcc), [Crater](https://sketchfab.com/3d-models/crater-22b83586db104adc8088a5bdcab40d6c) (dmillercg) | CC BY | 1.3M / 293k / 250k | 잔해 키트 교체 — 감량 필요 |
| 건물 | [War Damaged Hall / Church / Building / Building 2](https://sketchfab.com/3d-models/war-damaged-hall-2daf2f16bdb848dcaa9349366b6f5174) (local.yany) | CC BY | 177k–309k | 폐허 도시 건물 교체 1순위 |
| 건물 | [City Ruins Environment](https://sketchfab.com/3d-models/city-ruins-environment-0d32be87779243749417ec783fb3ef60) (falk) | CC BY | 56k | 가벼운 폐허 세트 |
| 건물 | [Ruined buildings pack](https://sketchfab.com/3d-models/ruined-buildings-pack-free-download-690edb7d64b84df7bfeee3b54746d6eb) (tobiasherbers2) | CC BY | 86k | 후보 |
| 고딕 SF 건물 | [Sci-Fi Gothic Building For Aria Pack 1.0](https://sketchfab.com/3d-models/sci-fi-gothic-building-for-aria-pack-10-3b2e268239aa441ea41ac9b58fd47698) (chambersu1996) | CC BY | 561k (2.0판 4M) | 원경·대성당 교체 — 감량 필요 |
| 차원문 지형 | [Warp Portal Gate Terrain](https://sketchfab.com/3d-models/warp-portal-gate-terrain-warhammer-40k-9d8b62512b0b4833863d5126ff22acfa) (chernyi.r) | CC BY | 289k | 카오스 확장용 |
| 참호·방어물 | [Trench set](https://sketchfab.com/3d-models/trench-set-f91624a4e7bd4832ba06f8f7f3ff45e5), [Tank Trap](https://sketchfab.com/3d-models/tank-trap-483a5b9634b541c18180936ef434a522), [Barbed Wire](https://sketchfab.com/3d-models/barbed-wire-55ecdba178e94003856fb2aad45d7a31) | CC BY | 8k–245k | 참호·대전차 장애물·철조망 교체 |

제외한 Sketchfab 항목: "Imperial Praetorian Guard"(설명상 스타워즈), "Download Warhammer 40,000: Space Marine 2 / Boltgun 2 For PC" 류(모델이 아닌 스팸 링크), Free Standard 라이선스(재배포 조건이 CC보다 좁음), CC BY-ND(수정 금지 — 감량·리깅 불가), 공식 게임 추출물로 보이는 것.

## 4. 다른 사이트 조사 결과

| 사이트 | 결과 |
|---|---|
| Poly Haven | 채택 (2절). CC0, 로그인 불필요. 건물 모델은 없음 |
| SMK 덴마크 국립미술관 (open.smk.dk) | 채택 (2-1절). 조각상 석고 주형 3D 스캔, 퍼블릭 도메인, 공식 API로 로그인 없이 다운로드 |
| Smithsonian 3D (3d.si.edu) | 채택 (2-1절). CC0 조각상 스캔 2점 |
| ambientCG | 채택 (2-1절). CC0 PBR 텍스처, 로그인 불필요 |
| CGTrader 무료 "SpaceMarine" (리깅·텍스처, Blender 2.79) | 후보지만 다운로드에 로그인 필요 |
| TurboSquid / Fab(Quixel) | 다운로드에 로그인 필요, 무료 40K 모델 확인 못 함 |
| Cults3D / Printables / MyMiniFactory 고딕 SF 폐허 (Terrain4Print 등) | 3D 프린트용 STL — 텍스처·UV 없음, 대부분 CC BY-NC-SA, 일부 로그인 필요. 건물 후보로 보류 |
| DeviantArt "Rubric Marine (Space Marine 2)" | 공식 게임 추출물로 보여 제외 |
| Quaternius / Kenney / Poly Pizza | CC0이지만 로우폴리 카툰풍 — 화풍 불일치로 제외. 이번 수집에서 Quaternius는 다운로드가 사이트 버튼(대화형)으로만 열려 자동 수집 불가, kenney.nl은 자동 접속에 403. 브라우저 위장으로 우회하지 않았다 |

## 5. 법적 상황 요약
- 40K 팬 모델은 개별 라이선스가 CC BY여도 디자인 권리(Games Workshop IP) 위험이 남는다. 이 프로젝트는 비상업 팬 게임으로 유지하고, 모델 제작자 표기를 게임 크레딧과 이 문서에 남긴다.
- 리핑 모델은 업로더에게 권리가 없으므로 라이선스 표기와 관계없이 쓰지 않는다.
