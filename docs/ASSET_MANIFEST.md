# 에셋 목록 (ASSET_MANIFEST) — 2026-10-30

게임이 실제로 쓰는 모델과 이번에 조사한 외부 모델 후보를 모두 기록한다. **외부 모델은 하나도 내려받지 않았다** (이유는 아래 표의 "상태" 열).

## 1. 게임이 실제로 쓰는 모델

| 모델 | 출처 | 제작 방식 | 공개 빌드 | 비고 |
|---|---|---|---|---|
| 스페이스 마린 4종(전술·플라즈마·헤비 볼터·서전트) | 자체 제작 | `tools/blender/factions.py` 절차적 모델·리그·애니메이션 24종 | 포함 | 공개 Pages 기본 마린 |
| 카디안 5종, 크리그 3종, 오크 4종 | 자체 제작 | 같은 파이프라인 | 포함 | |
| **리만 러스 전차 (신규)** | 자체 제작 | `tools/blender/vehicles.py` → `tools/build_vehicles.mjs` | 포함 | 차체·궤도·포탑·포신 분리 피벗, 궤도 전용 UV(스크롤), AO 베이크. 188 kB |
| 환경 키트 29종 (건물·참호·드롭 포드·썬더볼트 등) | 자체 제작 | `tools/blender/env.py` | 포함 | |
| 텍스처 | 자체 제작 | 런타임 절차적 생성 (`src/world/textures.ts`), 이번에 차량 도장(`paint`)·궤도(`track`) 추가 | 포함 | |
| Space Marine (2011) 레안드로스·시도누스 + 볼터·체인소드, Havok 애니메이션 | 공식 게임 데모 추출 | `SpaceMarine1_Extracted/_tools/` | **제외** | 재배포 권한 없음. 개발 서버 `/local-assets/`로만 로드 |

## 2. 외부 모델 조사 결과

| 후보 | 출처 | 라이선스 | 규모·품질 | 상태 |
|---|---|---|---|---|
| "XYZ: Detalization Homework" (리만 러스 초안), d.marchankau | [Sketchfab](https://sketchfab.com/3d-models/xyz-detalization-homework-e84ddae0201d4e96b8004baf9b8eb429) | CC BY 4.0 (출처 표시) | 146,200 삼각형 / 76,000 정점. 텍스처·리그 여부 페이지에 표시 없음 | **미다운로드.** Sketchfab 다운로드는 로그인 계정이 필요하다(계정 로그인은 내가 대신할 수 없음). 받더라도 RTS용으로 1/10 이하 감량과 포탑 분리·리깅이 필요하고, 디자인 자체는 GW IP라 공개 빌드 위험은 자체 모델과 같다. 자체 모델로 대체 |
| "Leman Russ Old Turret" | [Sketchfab](https://www.sketchfab.com/3d-models/leman-russ-old-turret-44a5439b977e4bb98d1b4560197150c8) | 확인 못 함 | 4,600 삼각형 | 미다운로드 — 라이선스 미확인 |
| "Warhammer 40,000 Grey Knight", Block Forge | [Sketchfab](https://sketchfab.com/3d-models/warhammer-40000-grey-knight-6d7f0da56c94411e885981ccb0e80d1b) | CC BY 4.0 | 1,600 삼각형 | 제외 — 현재 마린(SM1 12,000 / 자체 27,000 삼각형)보다 품질이 크게 낮음 |
| Leman Russ STL (Cults3D 무료 목록 등) | [Cults3D](https://cults3d.com/it/modello-3d/gioco/free-leman-russ-strike-tank-and-additional-weapons-from-30k-to-40k) | 페이지에 명시 없음 | 3D 프린트용(텍스처·UV 없음) | 제외 — 라이선스 불명, GW가 3D 프린트 모델에 강경 대응 중 |
| Quaternius CC0 팩 (Ultimate Space Kit, Sci-Fi Essentials, 우주선 팩) | [quaternius.com](https://quaternius.com/packs/scifiessentialskit.html), [OpenGameArt](https://opengameart.org/content/lowpoly-spaceships-pack) | CC0 | 로우폴리 카툰풍 | 제외 — 전차 없음, 화풍 불일치 |
| CGTrader 무료 SF 전차 | [CGTrader](https://cgtrader.com/free-3d-models/military/military-vehicle/futuristic-modern-sci-fi-war-tank-black) | Royalty Free No AI | glTF 없음, 40K 디자인 아님 | 제외 |
| itch.io SF 포탑 팩 | [itch.io](https://sasvel.itch.io/sci-fi-turrets-pack) | CC BY 4.0, 최소 $4.99 | 리깅된 포탑 glTF | 미구매 — 결제는 사용자만 가능, 40K 디자인 아님 |
| Dawn of War Unification / Soulstorm 모드 모델 | [ModDB](https://www.moddb.com/mods/unification-mod-dawn-of-war-soulstorm) | 공개 재사용 조건 없음, 모드 간 개별 허락 관행 | 게임 전용 포맷 | 제외 — 재배포 권한 없음 |
| Garry's Mod / TTS / Steam Workshop 40K 팩 | Steam Workshop | 대부분 공식 게임 추출물 | — | 제외 — 공식 에셋 추출물은 권한 없음 (개별 항목 미조사) |

## 3. 법적 상황 요약 (조사 근거)
- Games Workshop IP 가이드라인은 팬 제작물을 비상업으로 제한하고, 무료라도 "전문적인 배포"는 허용하지 않는다는 해석이 일반적이다. 3D 프린트 모델 배포 사이트(Cults3D 등)와 분쟁 사례가 있다. ([PC Gamer](https://pcgamer.com/games-workshop-is-trying-to-shut-down-fan-animations), [Fauxhammer](https://www.fauxhammer.com/news/games-workshop-vs-cults-3d-the-3d-printing-war-heats-up))
- 따라서 외부 40K 팬 모델은 개별 라이선스가 CC BY여도 디자인 권리 위험이 그대로 남는다. 이 프로젝트는 자체 제작 모델 + 비공개 로컬 참고 에셋 분리 원칙을 유지한다.

## 4. 사용자 결정이 필요한 것
- Sketchfab CC BY 리만 러스(146k)를 고품질 근접용으로 쓰려면: 사용자가 Sketchfab에 로그인해 파일을 받아 `SpaceMarine1_Extracted` 같은 저장소 밖 폴더에 두면, 감량·분리·리깅 파이프라인에 넣을 수 있다. 공개 빌드에 넣을지는 출처 표시 조건과 GW IP 위험을 보고 사용자가 결정.
- 유료 에셋 구매는 사용자만 가능.
