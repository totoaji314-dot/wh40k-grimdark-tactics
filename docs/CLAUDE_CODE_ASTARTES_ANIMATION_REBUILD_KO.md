# Grimdark Tactics — 코덱스 아스타르테스 / 애니메이션·전술전투 전면 개편 지시 (2026-10-28)

대상: `totoaji314-dot/wh40k-grimdark-tactics`. 이 문서는 작업 지시와 검증 기준이다. **기능 구현 완료 선언이 아니다.**

## 우선 점검할 실제 코드
- `tools/blender/kit.py` `factions.py` `anims.py` `build.py`: 메시 구조, 리그, 클립별 키프레임/실제 본 변형, LOD.
- `src/sim/anim.ts`: 애니메이션 상태 및 크로스페이드 시간 관리. 실제 포즈 변화는 이 파일이 아니라 렌더러의 스키닝/클립 데이터 연결까지 확인할 것.
- `src/render/UnitRenderer.ts`, `UnitLibrary.ts`: GLB 클립 바인딩, 이벤트 타이밍, 인스턴스/LOD별 본 변형.
- `src/sim/AI.ts`, `Battle.ts`, `Nav.ts`, `data.ts`: 유닛/병사 상태, 대열, 이동, 사격, 명중, 엄폐, 근접전, 사기.
- `src/ui/Hud.ts`, `Menu.ts`, `style.css`: 선택, 포메이션 UI, 명령 카드, 모바일 조작.
- 기존 게임 플레이 URL `https://totoaji314-dot.github.io/wh40k-grimdark-tactics/`를 유지하고 기능을 삭제하지 말 것.

## 최우선 품질 결함과 통과 기준
1. 캐릭터를 확대해서 정면/측면/후면 확인. Space Marine (2011) 게임은 **근거리 캐릭터 품질의 시각적 기준**이지 브라우저 수백 명 전투에서 동일한 폴리곤/텍스처 보증이 아니다. 해상도/LOD별 예산과 한계는 실제 수치 보고.
2. 기본 idle/walk/run/charge/aim/fire/reload/recoil/melee hit&parry/hurt/stagger/death/crouch/cover/turn-in-place/command를 **보이는 본·관절의 실제 포즈로** 구현. 손 무기 고정/접지 IK/풋플랜트/루트 모션 또는 속도 동기화/좌우 스트레이프/몸통 상하 분리(upper/lower) 및 크로스페이드 확인.
3. 사격 판정은 총구/목표 정렬, 사전 조준과 방아쇠 프레임 및 실제 발사체 타이밍 일치. 재장전 클립과 탄창 타이밍 일치. 피격 방향·사망 전환은 애니메이션과 실제 데이터가 동기화.
4. 진형 전환, 90°/180° 회두, 장애물 회피, 복도 통과, 전열 재정렬, 공격 중 추적, 근접전 1대다/협공, 상대 분리/타격 리액션 등을 자동 시나리오와 수동 영상으로 검증.
5. PC/디벗 성능 목표: 기본 30 vs 100, 100 vs 100, 대형 230 vs 300과 530 vs 1060. 프레임 타임 p50/p95/p99, VRAM, 로드 시간, 컨텍스트 손실/복구 보고. 낮은 성능에서 병사 수를 임의로 숨기지 말고 시각 LOD·애니메이션 LOD를 조절.

## 코덱스 아스타르테스 — 시대/편제 구분
- 고전(2011년 무렵) Firstborn: Tactical / Assault / Devastator / Terminator / Scout 등의 역사적 병과.
- 최신(2026년 공식 코덱스): Tacticus/Phobos/Gravis 등 현대형 Intercessor, Assault Intercessor, Hellblaster, Infernus, Aggressor, Eliminator, Eradicator, Bladeguard, Terminator 등 별도 분류.
- 2026년 공식 발표에서 Tactical/Devastator는 신규 코덱스 본편 편성에서 Legendary Proxies 등으로 분류 변경. **설정 시대와 룰 에디션을 혼합하지 말 것**. 플레이어가 '클래식 Firstborn'과 '현행 Primaris'의 독립 로스터를 선택하도록 설계.
- Codex-compliant 챕터의 전통적 기준 약 10개 중대·중대당 약 100명, 일반 전투중대 6 Battleline + 2 Close Support + 2 Fire Support 구성. 실제 전장 투입은 30명 파견대 등 소규모일 수 있음.
- 장교/부대 지휘: Chapter Master → Captain → Lieutenant → Sergeant. 직책(Chaplain/Apothecary/Librarian/Techmarine/Ancient 등)은 실제 지휘 관계와 지원 기능을 구별.
- 5인 Combat Squad, 10인 분대, 장교 오라, 중대 표식, 서전트/베테랑 헬멧/견갑 표시, 무장/장갑 실루엣; 출처별 시대와 예외 기록.
- 소설·코덱스 등에서 직접 확인한 명칭·편제와 게임 밸런스를 위해 창작한 수치를 `research/LORE_VS_BALANCE_KO.md`에 구분.

## 배치 병력과 전술
- 기존 선택 전투: Space Marine 30명, Astra Militarum 100명, Death Korps of Krieg 100명, Orks 100명.
- 매 진영 1개 모델에 색칠만 하지 않음: 장교/서전트/중화기/근접/지원/의무/통신/차량 등의 메시 구조·표식·장비·동작 차별화.
- 전투 UI: 상하단 정보 중복 금지, 유닛 카드, 하이라이트, 깃발, 사거리/사선, 사기/피로/탄약, 이동·공격·방어·돌격·진형·특수능력, 그룹, 명령 예약(Shift), 사전 배치 영역, 드래그 포메이션의 방향/폭/깊이.
- AI: 단위병사 상태머신+분대 목표 행동+상위 지휘관 전술. 근접 접촉 시 회피/자세 전환/블록/타격 반응/피니셔/측후면 공격 및 사망 상태 처리. 실제 맵 장애물의 충돌과 LOS 검사.

## Space Marine 1 (2011) Demo 자료 조사
- Steam 데모 App 55410, data depot 55420, 약 2.13GiB (SteamDB).
- 파일 목록에 `data/chunks/ebp_sets__player_set.oppc`, `ebp_sets__ork_core_units.oppc`, `ebp_sets__entourage_mira.oppc` 등이 확인됨.
- 이용자 PC의 **설치 위치를 확인한 뒤 파일 목록/형식/헤더/폴더 계층을 먼저 보고**. `.oppc` 아카이브가 Blender용 모델이나 임의 추출이 가능한 것으로 단정하지 말 것.
- 본 게임·데모의 저작권 모델/소리/텍스처를 GitHub와 공개 Pages에 무단 재배포하지 말 것. 합법적인 로컬 참고·기술 이해만 하고, 공개 빌드는 자체 창작 또는 별도 재사용 허가를 받은 에셋 사용.
- 모델 활용 여부가 불명확하면 사용 가능한 원본/미확인/배포 금지로 구분하고 누락을 가짜 모델로 감추지 말 것.

## 공식 / 참조 자료
- https://steamdb.info/app/55410/
- https://steamdb.info/depot/55420/manifests/
- https://www.warhammer-community.com/en-gb/articles/jfqdowqw/behold-the-most-impressive-codex-space-marines-yet/
- https://www.warhammer-community.com/en-gb/articles/ifgezlgu/space-marines-rules-first-look/
- https://www.warhammer-community.com/en-gb/articles/bbnskauh/big-space-marines-news/
- https://warhammer40k.wiki.gg/wiki/Codex_Astartes

## 개발 순서와 증거
1. 현재 코드/모델/애니메이션 실태 보고: 존재하는 클립 이름만 나열하지 말고 관절별 실제 키프레임과 화면상 움직임 검사.
2. 마린 1명 근거리 품질 개선 → 사격·재장전·걷기·근접 2인 교전 검증 → 10인 분대 → 30 vs 100 전투.
3. 네 진영 전체 적용·전술 UI·AI 개선 후 100 vs 100, 대규모 530 vs 1060 장면 성능 테스트.
4. `npm ci`, `npm test` (또는 repo 스크립트), `npm run build`; 실제 브라우저 PC/모바일 터치 검증. 확실한 테스트 결과만 보고.
5. 코드와 허가된 에셋만 GitHub push; GitHub Pages 자동배포 성공 확인; 기존 URL 유지. 데모 모델은 결코 공개 dist에 포함하지 말 것.

**최종 보고 형식:** 변경한 경로/커밋, 모델과 애니메이션의 실제 프레임 증거, 성능 표, 설정 고증 출처, 사용 에셋 라이선스, 정상 접속 링크, 미구현·미검증 항목.