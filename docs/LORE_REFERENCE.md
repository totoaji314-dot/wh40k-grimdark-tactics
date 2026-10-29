# 설정 고증 참고 (작업 중)

신뢰도 표기: **확인** = 이번에 공식 자료 원문을 직접 읽음 · **일반 설정** = 오랜 공식 설정으로 알려져 있으나 이번에 원문 대조 안 함 · **게임 변경** = 밸런스/구현을 위해 바꾼 부분.
소설(Helsreach, Brothers of the Snake, Cadian Blood, Brutal Kunnin)은 **읽지 않았다**. 소설 근거 항목은 아직 없다.

## 공식 자료에서 직접 확인한 내용
| 출처 | 확인한 사실 | 게임 반영 |
|---|---|---|
| Warhammer Community, "Big Space Marines news" (2026-08-24) https://www.warhammer-community.com/en-gb/articles/bbnskauh/big-space-marines-news/ | 신 코덱스(10월 출시)에서 **Tactical Squad → Intercessor Squad, Devastator Squad → Desolation Squad, Suppressor Squad → Inceptor Squad**로 "Legendary Proxies" 처리. Centurion·Razorback·Predator·Vindicator·Whirlwind·Dreadnought 등은 Warhammer Legends 이동. Tacticus 보병 T5, Phobos T4+이동 8". 기사에 Assault Squad 언급 없음 | 현재 게임의 "전술 분대/데바스테이터 분대"는 **클래식 퍼스트본 편제**로 표기해야 함(미반영 — 다음 작업) |
| Warhammer Community, "The anatomy of power armour" https://www.warhammer-community.com/en-gb/articles/Du2wvip7/the-anatomy-of-power-armour/ | Mk VII/VIII 흉갑(plastron)에 아퀼라 또는 날개 해골, 견갑은 탄을 흘리도록 성형되고 챕터·분대 표식, 적을 향한 견갑에 추가 장갑을 붙이면 챕터 상징은 반대쪽으로, 헬멧(포토렌즈·복스·호흡기), 백팩 배기구, 순결의 인장, 데바스테이터의 보강 정강이(반동 서스펜서) | 흉갑 아퀼라+해골, 높은 견갑, 순결의 인장, 백팩 배기구 반영. 견갑 표식 좌우 배치는 **미반영** |

## 병종 데이터 (현재 게임에 있는 것)
| 병종 | 진영 | 시대/분류 | 갑옷 | 무장 | 역할 | 신뢰도 | 구현 상태 |
|---|---|---|---|---|---|---|---|
| 전술 마린 | Space Marines | 클래식 퍼스트본 (2026 코덱스에서 Intercessor 대리) | Mk VII 계열 | 볼터 | 전열 | 확인(분류) | 모델·애니·AI ✅ |
| 플라즈마 마린 | Space Marines | 클래식, 분대 특수무기 | Mk VII | 플라즈마 건 | 대장갑 | 일반 설정 | ✅ |
| 헤비 볼터 마린 | Space Marines | 클래식 데바스테이터 (2026 코덱스에서 Desolation 대리) | Mk VII | 헤비 볼터 | 화력 지원 | 확인(분류) | ✅ |
| 마린 서전트 | Space Marines | 분대장 | Mk VII + 월계관·볏 | 체인소드+볼트 피스톨 | 지휘 | 일반 설정 | ✅ |
| 카디안 가드맨/특수/중화기/서전트/장교 | Astra Militarum | Cadian | 플랙 아머·위장복 | 라스건 등 | 전열·지휘 | 일반 설정 | ✅ |
| 크리그 근위병/중화기/워치마스터 | Death Korps of Krieg | Krieg | 그레이트코트·방독면·철모 | 총검 라스건 등 | 참호전 | 일반 설정 | ✅ |
| 보이/슈타 보이/놉/워보스 | Orks | — | 고철 갑옷 | 초파·슬러가·슈타·파워 클로 | 돌격 | 일반 설정 | ✅ |

## 요청된 확장 병종 — 미구현 (데이터·모델 없음)
Assault Marines, Terminators, Intercessors, Hellblasters, Bladeguard/Sternguard Veterans, Captain, Lieutenant, Chaplain, Librarian, Catachan, Tempestus Scions, Stormboyz, Lootas, Burna Boyz, Gretchin, 모든 차량. 각 병종은 공식 자료 대조 후 별도 모델이 필요하다.

## 게임 밸런스를 위해 바꾼 부분
- 근접 동시 공격 상한(가드맨 2, 오크 3, 마린·놉 4, 워보스 6)과 참호 안 병사의 상한 −1: 설정이 아니라 전술 게임 규칙.
- 크리그 참호 사기 보너스(+14): "크리그는 쉽게 물러서지 않는다"는 일반 설정을 게임 수치로 옮긴 것.
- 무기 사거리·피해·장갑 수치(`src/sim/data.ts`)는 테이블탑 규칙의 직접 이식이 아니다.
