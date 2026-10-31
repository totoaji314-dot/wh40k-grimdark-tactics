# 에셋 출처와 권리

## 공개 저장소·GitHub Pages에 포함된 것
| 에셋 | 출처 | 권리 |
|---|---|---|
| 모든 병사 모델·리그·애니메이션 (`public/assets/units`) | 이 저장소 `tools/blender/*.py`로 직접 생성 | 이 프로젝트 자체 제작 |
| 환경 키트 26종 (`public/assets/env`) | `tools/blender/env.py`로 직접 생성 | 자체 제작 |
| 지형·재질 텍스처 | 런타임 절차적 생성 (`src/world/textures.ts`) | 자체 제작 |
| 사진 스캔 소품 9종 (`public/assets/props/props.glb`), 홀리 테라 가로등·탐조등 (`props/terra.glb`) | Poly Haven (제작자·링크는 `docs/ASSET_MANIFEST.md` 2절) | CC0 |
| 홀리 테라 황궁 건축물·황금 옥좌·깃발·화로·순례자·서보 스컬·라이노 (`public/assets/terra/palace.glb`) | `tools/blender/terra_landmarks.py`로 직접 모델링 | 자체 제작 |
| 같은 파일의 조각상 14점 | SMK 덴마크 국립미술관 3D 스캔 (`open.smk.dk`, 목록은 ASSET_MANIFEST 2-1절) | 퍼블릭 도메인 (CC PDM 1.0) |
| 같은 파일의 조각상 2점 (황제 좌상·기마상) | Smithsonian 3D (`3d.si.edu`) | CC0 |
| 같은 파일의 타일 텍스처 15종 | ambientCG | CC0 |
| 효과음 | WebAudio 실시간 합성 (`src/core/Audio.ts`) | 자체 제작 |
| three.js, meshoptimizer, glTF-Transform, Vite, sharp | npm | MIT / Apache-2.0 |

## 공개 빌드에 포함하지 않은 것
| 자료 | 위치 | 이유 |
|---|---|---|
| Warhammer 40,000: Space Marine (2011) 데모 추출 모델·텍스처·Havok | `D:\01_BoltgunReference\SpaceMarine1_Extracted` (저장소 밖) | 공식 게임 에셋, 재배포 허가 없음. 로컬 기술 분석 전용 |
| 위 자료의 변환 결과(PNG, GLB, .blend, 렌더, 게임용 GLB·아틀라스) | 같은 폴더 `_analysis/`, `_game_build/`, `_game_assets/` | 같은 이유. 게임은 개발 서버(`npm run dev`)의 `/local-assets/` 경로로만 읽으며, 이 경로는 `vite build`와 GitHub Pages에 없다 |
| `Rifleman.glb` | 작업 폴더 | CC0이지만 2등신 카툰 스타일이라 사용하지 않음 |
| 홀리 테라 원본 다운로드 (Poly Haven·ambientCG·SMK·Smithsonian, 100개 1.09 GB) | `D:\01_BoltgunReference\Downloaded_Assets` (저장소 밖) | 원본 보관용. 공개 빌드에는 감량·압축한 `palace.glb`·`terra.glb`만 들어간다 |
| 황궁 중간 산출물 (`palace_src.glb`·`.blend`·미리보기 렌더) | `local_only/terra_build` (gitignore) | 다시 만들 수 있는 작업 파일 |

## IP 위험 (숨기지 않고 기록)
- 이 게임은 Games Workshop의 Warhammer 40,000 명칭·진영·설정을 사용하는 **비공식 비상업 팬 프로젝트**다. 모델·텍스처·소리는 자체 제작이지만, 명칭과 디자인 언어 자체는 GW의 IP다.
- GW의 IP 가이드라인은 팬 제작물에 제한적이며, 권리자 요청이 있으면 공개 페이지를 내려야 할 수 있다.
- 대안: 필요하면 명칭·문장을 독자 세계관으로 바꾼 공개 빌드를 분리할 수 있도록 병종·진영 이름은 `src/sim/data.ts`에 모여 있다.
