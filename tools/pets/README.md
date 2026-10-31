# 펫 도감 자료 만들기

`js/pet-data.js`, `assets/zones/*.jpg`, `assets/pets/icons/*.png` 는 이 폴더의 `build.py` 가 공개 자료로 만듭니다.
직접 고치지 말고 자료나 스크립트를 고친 뒤 다시 만드세요. (이 폴더는 웹에 공개되지 않습니다: `.assetsignore`)

## 1. 공개 자료 받기

아무 폴더(아래 `SRC`)에 다음 이름으로 받습니다. 필요한 파일만 받도록 sparse checkout 을 씁니다.

```bash
SRC=~/pet-src && mkdir -p $SRC && cd $SRC
```

```bash
git clone --depth 1 --filter=blob:none --no-checkout https://github.com/cmangos/classic-db.git cdb && git -C cdb checkout HEAD -- Full_DB
```

```bash
git clone --depth 1 --filter=blob:none --no-checkout https://github.com/Questie/QuestieDB.git qdb && git -C qdb checkout HEAD -- data/Classic/classicNpcDB.lua l10n/Classic/lookupNpcs/koKR.lua l10n/Forever/lookupNpcs/koKR.lua
```

```bash
git clone --depth 1 --filter=blob:none --no-checkout https://github.com/Questie/Questie.git questie && git -C questie checkout HEAD -- Localization/Translations/Zones
```

```bash
git clone --depth 1 --filter=blob:none --no-checkout https://github.com/shagu/pfUI.git pfui && git -C pfui checkout HEAD -- env/tables.lua
```

```bash
git clone --depth 1 --filter=blob:none --sparse --branch classic https://github.com/Gethe/wow-ui-textures.git tex && git -C tex sparse-checkout set ICONS WorldMap
```

(`tex` 의 `WorldMap` 은 큽니다. 필요한 지역 폴더만 받으려면 `sparse-checkout set ICONS WorldMap/Elwynn …` 처럼 지정)

## 2. 만들기

```bash
python3 -I tools/pets/build.py ~/pet-src .
```

Pillow 가 필요합니다 (`pip install pillow`).

## 자료 출처와 라이선스

| 자료 | 쓰는 것 | 라이선스 |
|---|---|---|
| [CMaNGOS classic-db](https://github.com/cmangos/classic-db) | 길들일 수 있는 야수(`CreatureTypeFlags & 1`), 종류, 레벨, 등급, 공격 속도, 피해 속성, 종류별 능력치 | GPLv3 |
| [QuestieDB](https://github.com/Questie/QuestieDB) | 출몰 위치(지역 지도 백분율), 한국어 야수 이름 | GPLv3 (자세한 내용은 그 저장소의 LICENSE.md) |
| [Questie](https://github.com/Questie/Questie) | 지역 이름 번역 | GPLv3 |
| [pfUI](https://github.com/shagu/pfUI) | 지역 지도의 탐험 지역 겹침 그림 위치 | MIT |
| [Gethe/wow-ui-textures](https://github.com/Gethe/wow-ui-textures) (classic) | 지역 지도 조각, 펫 종류 아이콘 | Blizzard Entertainment 자산 |

종류별 배울 수 있는 기술과 먹이는 바닐라 기준으로 `build.py` 의 `FAM` 표에 직접 적었습니다.
어느 야수가 어떤 단계의 기술을 가르치는지는 게임 데이터 표(CreatureSpellData)가 있어야 해서 아직 넣지 않았습니다.

## 와우 포에버와 다른 점

- 위치·레벨은 클래식(1.12~1.15) 기준입니다. 와우 포에버는 클래식 내용을 쓰지만 새 지역(리버글레이즈 등)의 야수는 없습니다.
- 포에버에서 지도 범위가 바뀐 지역은 멀고어, 동부 역병지대, 붉은마루 산맥, 스톰윈드입니다 (QuestieDB 의 `data/Forever/conversion.json`).
  앱에서 이 지역에는 "위치가 조금 다를 수 있음" 안내가 나옵니다.

## 3D 모델 넣기

1. 와우 포에버 설치 폴더를 [wow.export](https://github.com/Kruithne/wow.export) 등으로 열어 야수 모델을 glTF 바이너리(`.glb`)로 내보냅니다.
2. `assets/pets/models/` 에 넣고 `js/pet-models.js` 에 적습니다.
   - `wolf: 'assets/pets/models/wolf.glb'` → 늑대 종류 전체
   - `d11412: 'assets/pets/models/lupos.glb'` → 모델 번호 11412(야수 자료의 `m`)인 야수만
3. 모델이 있으면 앱이 `js/vendor/three/` 의 three.js 를 불러와 돌려 볼 수 있게 보여 줍니다. 애니메이션이 있으면 Stand/Idle 동작을 재생합니다.
