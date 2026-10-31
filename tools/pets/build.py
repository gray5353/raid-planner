# 펫 도감 자료 만들기 → js/pet-data.js, assets/zones/*.jpg, assets/pets/icons/*.png
#
# 쓰는 공개 자료 (SRC 폴더 안에 아래 이름으로 받아 둠, tools/pets/README.md 참고)
#   cdb/      CMaNGOS classic-db (GPLv3)  : 길들일 수 있는 야수(CreatureTypeFlags 1), 종류, 레벨, 공격 속도, 피해 속성
#   qdb/      QuestieDB (GPLv3)           : 출몰 위치(지도 백분율), 한국어 이름
#   questie/  Questie (GPLv3)             : 지역 이름 번역
#   tex/      Gethe/wow-ui-textures classic : 지역 지도 조각, 펫 종류 아이콘 (Blizzard)
#   pfui/     shagu/pfUI (MIT)            : 탐험 지역 겹침 그림 위치
#
# 실행: python3 -I tools/pets/build.py <SRC> <저장소>
import sys, json, re, os, gzip, shutil, collections
from PIL import Image
SRC, REPO = sys.argv[1], sys.argv[2]
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sqlparse, lualit

# 1. 길들일 수 있는 야수
dump = [f for f in os.listdir(f'{SRC}/cdb/Full_DB') if f.endswith('.sql.gz')][0]
sql = gzip.open(f'{SRC}/cdb/Full_DB/{dump}', 'rt', encoding='utf-8', errors='replace').read()
tame = {c['Entry']: c for c in sqlparse.table(sql, 'creature_template') if c['CreatureTypeFlags'] & 1 and c['Family']}
MODS = {r['family']: (r['healthModifier'], r['damageModifier'], r['armorModifier']) for r in sqlparse.table(sql, 'pet_familystats')}
del sql

# 2. 출몰 위치 (QuestieDB 클래식: {[지역] = {{x, y}, …}})
q = {}
for line in open(f'{SRC}/qdb/data/Classic/classicNpcDB.lua', encoding='utf-8'):
    m = re.match(r'^\[(\d+)\] = (\{.*\}),\s*$', line)
    if m and int(m.group(1)) in tame:
        v = lualit.parse(m.group(2))
        if isinstance(v[6], dict) and v[6]: q[int(m.group(1))] = v

def ko_names(path):
    out = {}
    for line in open(path, encoding='utf-8'):
        m = re.match(r'^\[(\d+)\] = \{"((?:[^"\\]|\\.)*)"', line)
        if m: out[int(m.group(1))] = m.group(2)
    return out
ko = ko_names(f'{SRC}/qdb/l10n/Classic/lookupNpcs/koKR.lua')
ko.update(ko_names(f'{SRC}/qdb/l10n/Forever/lookupNpcs/koKR.lua'))

def overlay_data(pf_tables):
    s = open(pf_tables, encoding='utf-8').read()
    body = s[s.index('pfMapOverlayData = {'):]
    return {m.group(1).lower(): re.findall(r'"([^"]+)"', m.group(2))
            for m in re.finditer(r'^\s*\["([^"]+)"\] = \{(.*?)\},?\s*$', body, re.M)}

ERRATA = {('tirisfal', 'BRIGHTWATERLAKE'): ('x', 587, 584), ('silverpine', 'BERENSPERIL'): ('y', 417, 415)}

def zone_map(TEX, data, folder, out_path):
    """지역 지도: 바탕 조각 12장 + 탐험 지역 겹침 그림(pfUI 의 바닐라 위치)을 합쳐 1002x668 JPEG 로"""
    d = os.path.join(TEX, folder)
    files = {f.lower(): f for f in os.listdir(d)}
    canvas = Image.new('RGBA', (1024, 768), (18, 18, 18, 255))
    base = re.sub(r'[^a-z]', '', folder.lower())
    for t in range(1, 13):
        f = files.get(f'{folder.lower()}{t}.png')
        im = Image.open(os.path.join(d, f)).convert('RGBA')
        canvas.alpha_composite(im, (((t - 1) % 4) * 256, ((t - 1) // 4) * 256))
    key = {'blastedlands': 'blastedlands', 'thousandneedles': 'thousandneedles'}.get(base, base)
    ovs = data.get(key, [])
    used = 0
    for o in ovs:
        name, w, h, x, y = o.split(':')[:5]
        w, h, x, y = int(w), int(h), int(x), int(y)
        e = ERRATA.get((key, name))
        if e and e[0] == 'x' and x == e[1]: x = e[2]
        if e and e[0] == 'y' and y == e[1]: y = e[2]
        # 바닐라 화면과 같은 방식: 256 칸으로 나눈 조각, 마지막 줄·칸은 실제 크기만큼만 (같은 이름의 나중 확장팩 조각은 무시)
        wide, tall = -(-w // 256), -(-h // 256)
        ok = True
        for r in range(tall):
            ph = 256 if r < tall - 1 else (h % 256 or 256)
            for c in range(wide):
                pw = 256 if c < wide - 1 else (w % 256 or 256)
                f = files.get(f'{name.lower()}{r * wide + c + 1}.png')
                if not f: ok = False; continue
                im = Image.open(os.path.join(d, f)).convert('RGBA')
                fw = 256 if c < wide - 1 else max(16, 1 << (pw - 1).bit_length())
                fh = 256 if r < tall - 1 else max(16, 1 << (ph - 1).bit_length())
                if im.size != (fw, fh): print('  size differs', folder, name, im.size, (fw, fh))
                piece = im.crop((0, 0, min(pw, im.width), min(ph, im.height)))
                canvas.alpha_composite(piece, (x + 256 * c, y + 256 * r))
        if not ok: print('  missing piece', folder, name)
        used += 1
    out = canvas.crop((0, 0, 1002, 668)).convert('RGB')
    out.save(out_path, quality=80, optimize=True, progressive=True)


# 지역 이름 번역 (Questie)
zko = {}
for f in ['EasternKingdoms', 'Kalimdor', 'Dungeons', 'Raids', 'Battlegrounds']:
    s = open(f'{SRC}/questie/Localization/Translations/Zones/{f}.lua', encoding='utf-8').read()
    for m in re.finditer(r'\["([^"]+)"\] = \{(.*?)\n\s*\},', s, re.S):
        k = re.search(r'\["koKR"\] = "([^"]+)"', m.group(2))
        if k: zko[m.group(1)] = k.group(1)

# 지역: id → (영어 이름, 지도 폴더 또는 던전 도감 id)
ZONES = {
 1: ('Dun Morogh', 'DunMorogh'), 3: ('Badlands', 'Badlands'), 4: ('Blasted Lands', 'BLASTEDLANDS'), 8: ('Swamp of Sorrows', 'SwampOfSorrows'),
 10: ('Duskwood', 'Duskwood'), 11: ('Wetlands', 'Wetlands'), 12: ('Elwynn Forest', 'Elwynn'), 14: ('Durotar', 'Durotar'),
 15: ('Dustwallow Marsh', 'Dustwallow'), 16: ('Azshara', 'Aszhara'), 17: ('The Barrens', 'Barrens'), 28: ('Western Plaguelands', 'WesternPlaguelands'),
 33: ('Stranglethorn Vale', 'Stranglethorn'), 36: ('Alterac Mountains', 'Alterac'), 38: ('Loch Modan', 'LochModan'), 40: ('Westfall', 'Westfall'),
 44: ('Redridge Mountains', 'Redridge'), 45: ('Arathi Highlands', 'Arathi'), 46: ('Burning Steppes', 'BurningSteppes'), 47: ('The Hinterlands', 'Hinterlands'),
 51: ('Searing Gorge', 'SearingGorge'), 85: ('Tirisfal Glades', 'Tirisfal'), 130: ('Silverpine Forest', 'Silverpine'), 139: ('Eastern Plaguelands', 'EasternPlaguelands'),
 141: ('Teldrassil', 'Teldrassil'), 148: ('Darkshore', 'Darkshore'), 215: ('Mulgore', 'Mulgore'), 267: ('Hillsbrad Foothills', 'Hilsbrad'),
 331: ('Ashenvale', 'Ashenvale'), 357: ('Feralas', 'Feralas'), 361: ('Felwood', 'Felwood'), 400: ('Thousand Needles', 'Thousandneedles'),
 405: ('Desolace', 'Desolace'), 406: ('Stonetalon Mountains', 'StonetalonMountains'), 440: ('Tanaris', 'Tanaris'), 490: ("Un'Goro Crater", 'UngoroCrater'),
 618: ('Winterspring', 'Winterspring'), 1377: ('Silithus', 'Silithus'), 1519: ('Stormwind City', 'Stormwind'), 1638: ('Thunder Bluff', 'ThunderBluff'),
 209: ('Shadowfang Keep', '@sfk'), 491: ('Razorfen Kraul', '@rfk'), 718: ('Wailing Caverns', '@wc'), 719: ('Blackfathom Deeps', '@bfd'),
 796: ('Scarlet Monastery', '@sm'), 1337: ('Uldaman', '@ulda'), 1477: ('Sunken Temple', '@st'), 1583: ('Blackrock Spire', '@lbrs'),
 1977: ("Zul'Gurub", '@'), 2100: ('Maraudon', '@mara'), 2597: ('Alterac Valley', '@'),
}
ZKO_FIX = {'Sunken Temple': '아탈학카르 신전', 'Blackrock Spire': '검은바위 첨탑'}

# 가족 (CreatureFamily): 배울 수 있는 기술·먹이는 바닐라 기준
FAM = {
 1: ('wolf', '늑대', 'Wolf', 'Wolf', ['bite', 'dash', 'howl'], ['meat']),
 2: ('cat', '살쾡이', 'Cat', 'Cat', ['bite', 'claw', 'dash', 'prowl'], ['fish', 'meat']),
 3: ('spider', '거미', 'Spider', 'Spider', ['bite'], ['meat']),
 4: ('bear', '곰', 'Bear', 'Bear', ['bite', 'claw'], ['bread', 'cheese', 'fish', 'fruit', 'fungus', 'meat']),
 5: ('boar', '멧돼지', 'Boar', 'Boar', ['bite', 'charge', 'dash'], ['bread', 'cheese', 'fish', 'fruit', 'fungus', 'meat']),
 6: ('crocolisk', '악어', 'Crocolisk', 'Crocolisk', ['bite'], ['fish', 'meat']),
 7: ('carrionbird', '독수리', 'Carrion Bird', 'Vulture', ['bite', 'claw', 'dive', 'screech'], ['fish', 'meat']),
 8: ('crab', '게', 'Crab', 'Crab', ['claw'], ['bread', 'fish', 'fruit', 'fungus']),
 9: ('gorilla', '고릴라', 'Gorilla', 'Gorilla', ['bite', 'thunderstomp'], ['fruit', 'fungus']),
 11: ('raptor', '랩터', 'Raptor', 'Raptor', ['bite', 'claw', 'dash'], ['meat']),
 12: ('tallstrider', '타조', 'Tallstrider', 'TallStrider', ['bite', 'dash'], ['cheese', 'fruit', 'fungus']),
 20: ('scorpid', '전갈', 'Scorpid', 'Scorpid', ['claw', 'scorpid'], ['meat']),
 21: ('turtle', '거북', 'Turtle', 'Turtle', ['bite', 'shell'], ['fish', 'fruit', 'fungus']),
 24: ('bat', '박쥐', 'Bat', 'Bat', ['bite', 'dive', 'screech'], ['fruit', 'fungus']),
 25: ('hyena', '하이에나', 'Hyena', 'Hyena', ['bite', 'dash'], ['fruit', 'meat']),
 26: ('owl', '올빼미', 'Owl', 'Owl', ['claw', 'dive', 'screech'], ['meat']),
 27: ('windserpent', '천둥매', 'Wind Serpent', 'WindSerpent', ['bite', 'dive', 'lightning'], ['bread', 'cheese', 'fish']),
}

beasts = []
zones_used = set()
for e, v in sorted(q.items()):
    c = tame[e]
    spawns = {}
    for z, pts in v[6].items():
        z = int(z)
        if z not in ZONES: print('unknown zone', z, c['Name']); continue
        seen, flat = [], []
        for p in pts:
            if not isinstance(p, list) or len(p) < 2 or p[0] is None or p[0] < 0: continue
            x, y = round(p[0] * 10), round(p[1] * 10)
            if any(abs(x - a) <= 3 and abs(y - b) <= 3 for a, b in seen): continue
            seen.append((x, y)); flat += [x, y]
        spawns[z] = flat
        zones_used.add(z)
    if not spawns: continue
    b = {'i': e, 'f': c['Family'], 'en': c['Name'], 'l': [c['MinLevel'], c['MaxLevel']], 'z': spawns}
    if ko.get(e): b['ko'] = ko[e]
    if c['Rank']: b['r'] = c['Rank']
    if c['MeleeBaseAttackTime'] != 2000: b['s'] = c['MeleeBaseAttackTime']
    if c['DamageSchool']: b['d'] = c['DamageSchool']
    if c['ModelId1']: b['m'] = c['ModelId1']
    beasts.append(b)
print('beasts', len(beasts), 'with ko', sum(1 for b in beasts if 'ko' in b), 'zones', len(zones_used))

OVERLAYS = overlay_data(f'{SRC}/pfui/env/tables.lua')
zones = {}
os.makedirs(f'{REPO}/assets/zones', exist_ok=True)
for z in sorted(zones_used):
    en, where = ZONES[z]
    zk = ZKO_FIX.get(en) or zko.get(en) or en
    if en not in zko and en not in ZKO_FIX: print('no ko for zone', en)
    o = {'ko': zk, 'en': en}
    if where.startswith('@'):
        o['dungeon'] = where[1:] or True
    else:
        name = where.lower() + '.jpg'
        zone_map(f'{SRC}/tex/WorldMap', OVERLAYS, where, f'{REPO}/assets/zones/{name}')
        o['map'] = 'assets/zones/' + name
    zones[z] = o

os.makedirs(f'{REPO}/assets/pets/icons', exist_ok=True)
fams = []
cnt = collections.Counter(b['f'] for b in beasts)
for fid, (key, fko, fen, icon, skills, diet) in FAM.items():
    shutil.copyfile(f'{SRC}/tex/ICONS/Ability_Hunter_Pet_{icon}.PNG', f'{REPO}/assets/pets/icons/{key}.png')
    h, d, a = MODS[fid]
    fams.append({'id': fid, 'key': key, 'ko': fko, 'en': fen, 'icon': f'assets/pets/icons/{key}.png', 'skills': skills, 'diet': diet, 'mod': [h, d, a]})
    print(fen, cnt[fid])

def js(o): return json.dumps(o, ensure_ascii=False, separators=(',', ':'))
out = []
out.append('// 펫 도감 자료 (자동 생성: 직접 고치지 말고 만드는 스크립트를 고쳐 주세요)')
out.append('// 길들일 수 있는 야수·레벨·공격 속도: CMaNGOS classic-db (GPLv3) · 출몰 위치·한국어 이름: QuestieDB (GPLv3)')
out.append('// 지역 지도: 게임 안 지도 그림 (Blizzard), 탐험 지역 겹침 위치: pfUI (MIT) · 기술·먹이: 바닐라 기준')
out.append('// 야수: i 번호, f 가족, l [최소, 최대 레벨], r 등급(1 정예, 2 희귀 정예, 4 희귀), s 공격 속도(ms, 없으면 2000),')
out.append('//       d 피해 속성(5 암흑), m 모델 번호(CreatureDisplayInfo), z {지역: [x, y, x, y …] (지도 백분율 × 10)}')
out.append('(function () {')
out.append('  const RP = window.RP = window.RP || {};')
out.append('  RP.PET_FAMILIES = ' + js(fams) + ';')
out.append('  RP.PET_ZONES = ' + js(zones) + ';')
out.append('  RP.PET_BEASTS = [\n' + ',\n'.join('    ' + js(b) for b in beasts) + '\n  ];')
out.append('})();')
open(f'{REPO}/js/pet-data.js', 'w', encoding='utf-8').write('\n'.join(out) + '\n')
print('pet-data.js', os.path.getsize(f'{REPO}/js/pet-data.js') // 1024, 'KB')
