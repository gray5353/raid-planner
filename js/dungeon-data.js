// 던전 도감 데이터 (WoW: Forever)
//
// 던전: { id, ko, en, min, max (없으면 'min+'), zone:[ko,en], isNew, beta, map, bosses:[...], sources:[[이름, 주소]] }
// 보스: { ko, en, pos:[x,y] (지도 기준 0~1, 모르면 생략), opt (선택 보스), tips:[ko,en], loot:[...] }
// 아이템: { en, ko, slot:[ko,en], lvl, stats:[ko,en] } (모르는 칸은 생략)
//
// - 레벨 범위와 순서는 사이트의 던전 목록 기준입니다.
// - 신규 던전(isNew)은 베타 자료라 보스 구성·아이템이 출시 후 바뀔 수 있습니다 (beta: true 면 '확인 필요' 표시).
// - 클래식 던전의 보스 구성과 공략은 클래식 기준입니다. Forever 에서 달라질 수 있습니다.
// - 지도 이미지(map)와 보스 위치(pos)는 아직 없습니다. 앱의 편집 링크에서 지도를 올리고 보스 번호를 지도에 끌어다 놓으면
//   그 작전판에 저장되고, '데이터 내보내기'로 받은 JSON 을 여기에 옮기면 모든 사람에게 기본값이 됩니다.
(function () {
  const RP = window.RP = window.RP || {};
  const B = (ko, en, tips, extra) => Object.assign({ ko, en }, tips ? { tips } : {}, extra || {});

  RP.DUNGEONS = [
    // ---------------- 신규 던전 ----------------
    {
      id: 'dalaran', ko: '달라란 도시', en: 'City of Dalaran', min: 28, max: 33, zone: ['알터랙 산맥', 'Alterac Mountains'], isNew: true, beta: true,
      bosses: [
        B('Atrexis the Grave Knight', 'Atrexis the Grave Knight', ['첫 보스. 탱커를 무장 해제시키고 해골을 불러냅니다. 해골은 광역으로 빠르게 정리하세요.', 'First boss. Disarms the tank and summons skeletons; clear the skeletons quickly with AoE.'], {
          loot: [{ en: 'Graveweave Bindings' }, { en: "Bonebinder's Signet" }, { en: 'Gravespike Repeater' }]
        }),
        B('Arcane Anomaly', 'Arcane Anomaly', ['회전하는 광선(Focal Blast)을 피해 보스 주위를 함께 돌며 싸우세요. 시작하면 방 가장자리에 작은 쫄이 나옵니다.', 'Dodge the rotating Focal Blast beam by moving around the boss together. Small adds spawn at the room edge on pull.']),
        B('Fel Ancient', 'Fel Ancient', ['주변 보스를 먼저 잡아야 마나 장막이 풀린다는 보고가 있습니다. 휘감기(Entangle)에 걸린 두 사람이 겹치지 않게 떨어지세요.', 'Reported to sit behind a mana barrier until nearby bosses die. Entangle roots two players; keep them apart so the damage does not overlap.']),
        B('Lyn the Ignored', 'Lyn the Ignored', ['선택 보스. 그림자송곳니 성채 아루갈의 방에서 검은 고서를 구해 앰버밀 지맥 초점 근처에서 사용하면 소환됩니다. 어둠의 화살 일제 사격은 차단하세요.', 'Optional. Bring the Black Tome from Arugal\'s room in Shadowfang Keep and use it at the Ambermill Leyline Focus. Interrupt Shadow Bolt Volley.'], {
          opt: true, loot: [{ en: 'Tendonscraper Dagger' }, { en: 'Cartilage Shapers' }]
        }),
        B('Shade of the Archmage', 'Shade of the Archmage', ['마지막 보스. 방 밖으로 끌어내면 초기화되니 방 안에서 싸우세요.', 'Final boss. He resets if pulled out of his room, so fight inside it.'])
      ],
      note: ['보스는 7~9명으로 알려져 있고 아직 일부만 이름이 공개됐습니다.', 'Reported 7-9 bosses; only some are named so far.'],
      sources: [['Icy Veins', 'https://www.icy-veins.com/wow-forever/city-of-dalaran-guide'], ['method.gg', 'https://www.method.gg/wow-forever/dungeons/city-of-dalaran'], ['wowforever.be', 'https://wowforever.be/guides/dungeons/city-of-dalaran/']]
    },
    {
      id: 'thanes', ko: '영주의 전당', en: 'Hall of Thanes', min: 13, max: 18, zone: ['아이언포지 지하', 'Beneath Ironforge'], isNew: true, beta: true,
      bosses: [B('Durgen Dirgehammer', 'Durgen Dirgehammer', null, { note: ['마지막 보스', 'Final boss'] })],
      note: ['보스 4명 중 마지막 보스만 이름이 알려졌습니다.', 'Four bosses; only the final one is named so far.'],
      sources: [['wowforeverwiki.org', 'https://wowforeverwiki.org/dungeons']]
    },
    {
      id: 'lordaeron', ko: '로데론의 폐허', en: 'Ruins of Lordaeron', min: 15, max: 20, zone: ['티리스팔 숲', 'Tirisfal Glades'], isNew: true, beta: true,
      bosses: [
        B('The Baron', 'The Baron', ['강한 넉백에 탱커가 쉽게 죽고 위협 수준도 떨어집니다. 기절을 자주 걸고, 넉백 뒤 탱커가 다시 어그로를 잡으세요.', 'Heavy knockback can kill the tank and drops threat. Stun him often and let the tank re-take aggro after each knockback.'], {
          loot: [{ en: 'Meathook Slicer' }, { en: 'Abomination Bones' }, { en: 'Leftover Abomination Skin' }]
        }),
        B('Witherfang', 'Witherfang', ['입구 복도를 순찰합니다. 다른 무리와 함께 끌리지 않게 순찰 경로를 보고 당기세요.', 'Patrols the entrance hall. Watch her path so she is not pulled together with other packs.'], {
          loot: [{ en: 'Atrophic Girdle' }, { en: 'Witherbite Bracers' }, { en: 'Segmented Spider Leg' }]
        }),
        B('The Abandoned', 'The Abandoned', ['석상에서 소환되고 쫄이 웨이브로 나옵니다. 서리 회오리로 묶이니 미리 흩어지고, 생명력 흡수는 차단하세요.', 'Summoned from a statue, followed by add waves. Frost Nova roots everyone; interrupt Life Drain.']),
        B('Bjork', 'Bjork', ['대마법 보호막이 켜지면 시전 딜러는 잠시 멈추세요. 구울 무리 근처에서 당기지 마세요.', 'Casters pause while Anti-Magic Shield is up. Do not pull him near the ghoul packs.']),
        B('Viktor the Vile', 'Viktor the Vile', ['선택 보스. 불꽃을 켜면 시작되고 쫄이 다섯 웨이브 나옵니다.', 'Optional. Lighting a flame starts it, followed by five waves of adds.'], { opt: true }),
        B("Rath'mael", "Rath'mael", ['마지막 보스. 바닥에 불기둥(Flamestrike)이 떨어지면 바로 피하거나 차단하세요.', 'Final boss. Move out of or interrupt Flamestrike.']),
        B('Lordaeron Captain', 'Lordaeron Captain', ['호드 전용 희귀 보스로 알려져 있습니다.', 'Reported as a Horde-only rare.'], { opt: true })
      ],
      note: ['자료마다 보스 수가 6~7명으로 다릅니다.', 'Sources list 6-7 bosses.'],
      sources: [['Seramate', 'https://seramate.com/news/forever/2026/09/28/ruins-lordaeron-dungeon-guide-1f1bced4'], ['wowforever.be', 'https://wowforever.be/guides/dungeons/ruins-of-lordaeron/'], ['Conquest Capped', 'https://conquestcapped.com/guides/wow-forever/wow-forever-ruins-of-lordaeron-guide/']]
    },
    {
      id: 'excavation', ko: '저습지 발굴 현장', en: 'Excavation Site: Wetlands', min: 26, max: 31, zone: ['저습지', 'Wetlands'], isNew: true, beta: true,
      bosses: [
        B('소금가시', 'Saltspine', ['주변 순찰을 먼저 정리하고, 탱커가 대상을 잡은 뒤 공격하세요. 차단·해제 담당을 정하고 힐러의 마나와 사거리를 확인하세요.', 'Clear nearby patrols first and attack after the tank has aggro. Assign interrupts and dispels; watch healer mana and range.'], {
          loot: [
            { en: 'Supple Bellyskin Leggings', slot: ['가죽 다리', 'Leather legs'], lvl: 31, stats: ['방어도 92 · 체력 14 · 힘 6', 'Armor 92 · Stamina 14 · Strength 6'] },
            { en: 'Saltscale Girdle', slot: ['사슬 허리', 'Mail waist'], lvl: 31, stats: ['방어도 124 · 체력 9 · 힘 9', 'Armor 124 · Stamina 9 · Strength 9'] },
            { en: 'Glinteye Slippers', slot: ['천 발', 'Cloth feet'], lvl: 31, stats: ['방어도 33 · 체력 9 · 지능 6 · 정신력 6', 'Armor 33 · Stamina 9 · Intellect 6 · Spirit 6'] }
          ]
        }),
        B('그늘이빨', 'Shadetooth', null, {
          loot: [{ en: 'Raptorclaw Greaves' }, { en: "Raptor's Gaze" }, { en: 'Garb of Florid Feathers' }]
        }),
        B('Highland Horror', 'Highland Horror', ['얼라이언스 퀘스트 「Horrors in the Highland」 보스입니다. 장비는 떨어뜨리지 않고 퀘스트 아이템(Horrible Rootcore)만 나옵니다.', 'Alliance quest boss for "Horrors in the Highland". Drops only the quest item Horrible Rootcore, no gear.'], { opt: true }),
        B('유물 수호자', 'Relic Guardian', ['마지막 보스. 진영별 유물 퀘스트를 시작하는 Titan Relic 이 나옵니다.', 'Final boss. Drops the Titan Relic that starts each faction\'s relic quest chain.'], {
          loot: [{ en: 'Reliquary Mantle' }, { en: 'Golemsight Long Gun' }, { en: 'Ring of Power Regulation' }]
        })
      ],
      sources: [['method.gg', 'https://www.method.gg/wow-forever/dungeons/excavation-site-wetlands'], ['wowforeverguides.com', 'https://wowforeverguides.com/dungeons/excavation-site-wetlands'], ['zockify', 'https://www.zockify.com/forever/dungeons/excavation-site-wetlands/']]
    },

    // ---------------- 클래식 던전 (클래식 기준) ----------------
    {
      id: 'rfc', ko: '성난불길 협곡', en: 'Ragefire Chasm', min: 13, max: 18, zone: ['오그리마', 'Orgrimmar'],
      bosses: [
        B('오글플린트', 'Oggleflint', ['트로그 무리와 함께 있습니다. 주변을 먼저 정리하세요.', 'Sits with troggs; clear around him first.']),
        B('굶주린 타라가만', 'Taragaman the Hungerer', ['불지옥(Fire Nova) 광역 피해가 있어 근접 딜러 체력을 챙기세요.', 'Fire Nova hits melee; keep their health topped.']),
        B('기원사 제르고쉬', 'Jergosh the Invoker', ['저주와 약화 효과를 겁니다. 해제하고 시전은 차단하세요.', 'Curses and weakens; dispel and interrupt casts.']),
        B('바잘란', 'Bazzalan', ['독을 겁니다. 해독 가능한 직업이 해제하세요.', 'Applies poison; cleanse it.'])
      ]
    },
    {
      id: 'wc', ko: '통곡의 동굴', en: 'Wailing Caverns', min: 17, max: 24, zone: ['불모의 땅', 'The Barrens'],
      bosses: [
        B('여군주 아나콘드라', 'Lady Anacondra', ['수면을 걸고 치유합니다. 수면은 해제하고 치유 시전은 차단하세요.', 'Sleeps and heals; dispel sleep and interrupt heals.']),
        B('군주 코브란', 'Lord Cobrahn', ['뱀으로 변신하고 독을 겁니다.', 'Turns into a serpent and poisons.']),
        B('크레쉬', 'Kresh', ['물속을 떠도는 거북입니다. 위험하지 않습니다.', 'A wandering turtle in the water; low threat.'], { opt: true }),
        B('군주 피타스', 'Lord Pythas', ['수면과 치유를 씁니다. 차단 담당을 정하세요.', 'Sleeps and heals; assign interrupts.']),
        B('스컴', 'Skum', ['체력이 낮아지면 도망칩니다. 근처 무리를 끌고 오지 않게 막으세요.', 'Flees at low health; stop him from pulling more packs.']),
        B('군주 서펜티스', 'Lord Serpentis', ['수면과 치유를 씁니다.', 'Sleeps and heals.']),
        B('영생의 베르단', 'Verdan the Everliving', ['광역 넉백이 있습니다. 벽을 등지세요.', 'AoE knockback; keep your back to a wall.']),
        B('걸신들린 무타누스', 'Mutanus the Devourer', ['나랄렉스를 깨우는 의식 중 나타납니다. 공포와 수면을 조심하세요.', 'Appears during the Naralex awakening event; watch for fear and sleep.'])
      ]
    },
    {
      id: 'dm', ko: '죽음의 폐광', en: 'The Deadmines', min: 17, max: 26, zone: ['서부 몰락지대', 'Westfall'],
      bosses: [
        B('라크조르', 'Rhahk\'Zor', ['단순한 근접 보스입니다.', 'Simple melee boss.']),
        B('스니드', 'Sneed', ['벌목기를 먼저 부수면 스니드가 나옵니다.', 'Destroy the Shredder first, then Sneed jumps out.']),
        B('길니드', 'Gilnid', ['주조장 위쪽에 있습니다. 주변 고블린을 먼저 정리하세요.', 'Up in the foundry; clear the goblins around him first.']),
        B('미스터 스마이트', 'Mr. Smite', ['체력이 줄면 기절시키고 무기를 바꿉니다. 탱커 위협 수준을 넉넉히 쌓으세요.', 'Stuns and swaps weapons as his health drops; build plenty of threat.']),
        B('선장 그린스킨', 'Captain Greenskin', ['배 위에서 싸웁니다. 휩쓸기 공격은 탱커만 맞게 하세요.', 'Fought on the ship; let only the tank take his cleave.']),
        B('에드윈 밴클리프', 'Edwin VanCleef', ['체력이 50%쯤 되면 부하 둘을 부릅니다. 부하를 먼저 처리하세요.', 'Calls two guards around 50%; kill the guards first.']),
        B('쿠키', 'Cookie', ['배 안의 선택 보스입니다.', 'Optional boss on the ship.'], { opt: true })
      ]
    },
    {
      id: 'sfk', ko: '그림자송곳니 성채', en: 'Shadowfang Keep', min: 22, max: 30, zone: ['은빛소나무 숲', 'Silverpine Forest'],
      bosses: [
        B('레실고어', 'Rethilgore', ['쓰러뜨리면 갇힌 포로를 풀 수 있습니다.', 'Defeat him to free the prisoners.']),
        B('Razorclaw the Butcher', 'Razorclaw the Butcher', ['부엌의 근접 보스입니다.', 'Melee boss in the kitchen.']),
        B('남작 실버레인', 'Baron Silverlaine', ['유령 늑대를 부릅니다.', 'Summons ghostly wolves.']),
        B('사령관 스프링베일', 'Commander Springvale', ['치유하고 정의의 망치로 기절시킵니다. 치유 시전은 차단하세요.', 'Heals and stuns with Hammer of Justice; interrupt the heals.']),
        B('Odo the Blindwatcher', 'Odo the Blindwatcher', ['박쥐 둥지 근처라 몰려오는 박쥐를 조심하세요.', 'Near the bat roost; watch for extra bats.']),
        B('Fenrus the Devourer', 'Fenrus the Devourer', ['독을 겁니다.', 'Applies poison.']),
        B('Wolf Master Nandos', 'Wolf Master Nandos', ['늑대 무리와 함께 나옵니다. 늑대를 광역으로 정리하세요.', 'Comes with wolves; AoE them down.']),
        B('대마법사 아루갈', 'Archmage Arugal', ['순간이동하며 대상을 늑대인간으로 바꿉니다. 시전을 차단하세요.', 'Teleports around and turns players into worgen; interrupt him.'])
      ]
    },
    {
      id: 'bfd', ko: '검은심연 나락', en: 'Blackfathom Deeps', min: 24, max: 32, zone: ['잿빛 골짜기', 'Ashenvale'],
      bosses: [
        B("Ghamoo-ra", "Ghamoo-ra", ['방어도가 높은 거북입니다. 시간을 두고 잡으세요.', 'High-armor turtle; slow but safe.']),
        B('Lady Sarevess', 'Lady Sarevess', ['다중 사격과 서리 회오리를 씁니다.', 'Uses Multi-Shot and Frost Nova.']),
        B('Gelihast', 'Gelihast', ['멀록 무리 사이에 있습니다.', 'Among murloc packs.']),
        B('Lorgus Jett', 'Lorgus Jett', ['순찰하는 주술사입니다.', 'A patrolling shaman.'], { opt: true }),
        B('Baron Aquanis', 'Baron Aquanis', ['얼라이언스 퀘스트 보스입니다.', 'Alliance quest boss.'], { opt: true }),
        B('Twilight Lord Kelris', 'Twilight Lord Kelris', ['수면을 겁니다. 해제하세요.', 'Casts sleep; dispel it.']),
        B("Old Serra'kis", "Old Serra'kis", ['물속에서 싸웁니다. 호흡을 조심하세요.', 'Fought underwater; watch your breath.']),
        B("Aku'mai", "Aku'mai", ['마지막 보스. 광역 독 피해가 있으니 흩어지세요.', 'Final boss. Spread out for her poison cloud.'])
      ]
    },
    {
      id: 'stocks', ko: '스톰윈드 지하감옥', en: 'The Stockade', min: 24, max: 32, zone: ['스톰윈드', 'Stormwind City'],
      bosses: [
        B('Targorr the Dread', 'Targorr the Dread', ['체력이 낮으면 격노합니다.', 'Enrages at low health.']),
        B('Kam Deepfury', 'Kam Deepfury', ['방패로 막는 드워프입니다.', 'Shield-blocking dwarf.']),
        B('Hamhock', 'Hamhock', ['연쇄 번개를 씁니다. 차단하세요.', 'Casts Chain Lightning; interrupt it.']),
        B('Bazil Thredd', 'Bazil Thredd', ['마지막 방의 우두머리입니다.', 'Leader in the last cell.']),
        B('Dextren Ward', 'Dextren Ward', ['공포를 겁니다.', 'Casts fear.']),
        B('Bruegal Ironknuckle', 'Bruegal Ironknuckle', ['가끔 나오는 희귀 보스입니다.', 'Rare spawn.'], { opt: true })
      ]
    },
    {
      id: 'rfd', ko: '가시덩굴 구릉', en: 'Razorfen Downs', min: 25, max: null, zone: ['불모의 땅 남부', 'Southern Barrens'],
      bosses: [
        B("Tuten'kash", "Tuten'kash", ['징을 울리면 거미 웨이브 뒤에 나옵니다.', 'Ring the gong; he arrives after spider waves.']),
        B('Mordresh Fire Eye', 'Mordresh Fire Eye', ['화염 마법사입니다. 차단하세요.', 'Fire caster; interrupt him.']),
        B('Glutton', 'Glutton', ['체력이 줄면 격노합니다.', 'Enrages at low health.']),
        B('Amnennar the Coldbringer', 'Amnennar the Coldbringer', ['마지막 보스. 서리 회오리와 분신 소환이 있습니다.', 'Final boss. Frost Nova and summoned images.'])
      ]
    },
    {
      id: 'gnomer', ko: '놈리건', en: 'Gnomeregan', min: 29, max: 38, zone: ['던 모로', 'Dun Morogh'],
      bosses: [
        B('Grubbis', 'Grubbis', ['이벤트 웨이브 뒤에 나옵니다.', 'Arrives after an event wave.']),
        B('Viscous Fallout', 'Viscous Fallout', ['독 피해가 있습니다.', 'Deals poison damage.']),
        B('Electrocutioner 6000', 'Electrocutioner 6000', ['연쇄 번개를 씁니다.', 'Chain Lightning.']),
        B('Crowd Pummeler 9-60', 'Crowd Pummeler 9-60', ['근처 사람을 기절시킵니다.', 'Stuns nearby players.']),
        B('Mekgineer Thermaplugg', 'Mekgineer Thermaplugg', ['마지막 보스. 폭탄 로봇이 나오는 버튼을 눌러 막으세요.', 'Final boss. Press the buttons to stop the bomb bots.'])
      ]
    },
    {
      id: 'rfk', ko: '가시덩굴 우리', en: 'Razorfen Kraul', min: 29, max: 38, zone: ['불모의 땅 남부', 'Southern Barrens'],
      bosses: [
        B('Roogug', 'Roogug', ['토템을 먼저 부수세요.', 'Kill the totems first.']),
        B('Aggem Thorncurse', 'Aggem Thorncurse', ['치유를 차단하세요.', 'Interrupt heals.']),
        B('Death Speaker Jargba', 'Death Speaker Jargba', ['정신 지배를 겁니다.', 'Casts Mind Control.']),
        B('Overlord Ramtusk', 'Overlord Ramtusk', ['주변 무리를 먼저 정리하세요.', 'Clear the packs around him first.']),
        B('Agathelos the Raging', 'Agathelos the Raging', ['광역 공격이 강합니다.', 'Strong AoE melee.']),
        B('Charlga Razorflank', 'Charlga Razorflank', ['마지막 보스. 치유를 차단하세요.', 'Final boss. Interrupt her heals.'])
      ]
    },
    {
      id: 'ulda', ko: '울다만', en: 'Uldaman', min: 30, max: null, zone: ['황야의 땅', 'Badlands'],
      bosses: [
        B('Revelosh', 'Revelosh', ['번개 마법을 씁니다.', 'Lightning caster.']),
        B('The Lost Dwarves', 'The Lost Dwarves', ['드워프 셋이 함께 나옵니다. 하나씩 잡으세요.', 'Three dwarves at once; kill them one at a time.']),
        B('Ironaya', 'Ironaya', ['넉백이 강합니다. 벽을 등지세요.', 'Big knockback; back against a wall.']),
        B('Obsidian Sentinel', 'Obsidian Sentinel', ['작은 파수꾼으로 갈라집니다.', 'Splits into smaller sentinels.']),
        B('Ancient Stone Keeper', 'Ancient Stone Keeper', ['광역 피해가 있습니다.', 'AoE damage.']),
        B('Galgann Firehammer', 'Galgann Firehammer', ['불꽃 공격을 씁니다.', 'Fire attacks.']),
        B('Grimlok', 'Grimlok', ['번개 피해가 있습니다.', 'Lightning damage.']),
        B('Archaedas', 'Archaedas', ['마지막 보스. 수호자와 골렘을 깨웁니다. 쫄을 따로 탱하세요.', 'Final boss. Awakens guardians and golems; off-tank the adds.'])
      ]
    },
    {
      id: 'sm', ko: '붉은십자군 수도원', en: 'Scarlet Monastery', min: 34, max: 45, zone: ['티리스팔 숲', 'Tirisfal Glades'],
      bosses: [
        B('Interrogator Vishas', 'Interrogator Vishas', ['묘지 구역.', 'Graveyard wing.']),
        B('Bloodmage Thalnos', 'Bloodmage Thalnos', ['묘지 구역. 화염 마법을 차단하세요.', 'Graveyard wing. Interrupt fire spells.']),
        B('Houndmaster Loksey', 'Houndmaster Loksey', ['도서관 구역. 사냥개와 함께 나옵니다.', 'Library wing. Comes with hounds.']),
        B('Arcanist Doan', 'Arcanist Doan', ['도서관 구역. 비전 폭발 전에 멀어지세요.', 'Library wing. Get away before his Arcane Explosion.']),
        B('Herod', 'Herod', ['무기고 구역. 소용돌이 공격 때 흩어지세요.', 'Armory wing. Spread out during Whirlwind.']),
        B('Scarlet Commander Mograine', 'Scarlet Commander Mograine', ['대성당 구역.', 'Cathedral wing.']),
        B('High Inquisitor Whitemane', 'High Inquisitor Whitemane', ['대성당 구역. 모그레인을 되살립니다. 수면 후 부활에 대비하세요.', 'Cathedral wing. Resurrects Mograine; be ready after her sleep.'])
      ]
    },
    {
      id: 'drowned', ko: '가라앉은 도시', en: 'The Drowned City', min: 35, max: 40, zone: ['가시덤불 골짜기 앞바다', 'Off the Stranglethorn coast'], isNew: true, beta: true,
      bosses: [],
      note: ['보스 이름이 아직 공개되지 않았습니다 (블리즈컨 빌드에 3~4명).', 'Boss names not public yet (3-4 in the BlizzCon build).'],
      sources: [['wowforeverwiki.org', 'https://wowforeverwiki.org/dungeons']]
    },
    {
      id: 'kroldok', ko: '크롤도크 요새', en: "Krol'dok Stronghold", min: 40, max: 45, zone: ['리버글레이드', 'Riverglades'], isNew: true, beta: true,
      bosses: [],
      note: ['보스 구성이 아직 확인되지 않았습니다. 5부위 세트 「Krol\'dok Battlegear」 가 데이터에 있다고 알려져 있습니다.', 'Boss roster not verified yet. A 5-piece "Krol\'dok Battlegear" set is reported in the data.'],
      sources: [['expcarry', 'https://expcarry.com/wow-forever-kroldok-stronghold-guide']]
    },
    {
      id: 'zf', ko: '줄파락', en: "Zul'Farrak", min: 44, max: 54, zone: ['타나리스', 'Tanaris'],
      bosses: [
        B("Antu'sul", "Antu'sul", ['바실리스크를 부릅니다.', 'Summons basilisks.']),
        B('Theka the Martyr', 'Theka the Martyr', ['물리 피해 면역 단계가 있습니다.', 'Has a physical-immunity phase.']),
        B("Witch Doctor Zum'rah", "Witch Doctor Zum'rah", ['묘지에서 좀비가 나옵니다.', 'Raises zombies from the graves.']),
        B('Sergeant Bly', 'Sergeant Bly', ['계단 이벤트 뒤에 싸웁니다. 웨이브를 계단 위에서 막으세요.', 'Fought after the stairs event; hold the waves at the top.']),
        B('Gahz\'rilla', 'Gahz\'rilla', ['징을 울려 소환합니다. 얼리기 공격을 조심하세요.', 'Summoned with the gong; watch for freeze.'], { opt: true }),
        B('Chief Ukorz Sandscalp', 'Chief Ukorz Sandscalp', ['마지막 보스. 루줄루와 함께 나옵니다.', 'Final boss, together with Ruuzlu.'])
      ]
    },
    {
      id: 'mara', ko: '마라우돈', en: 'Maraudon', min: 46, max: 55, zone: ['잊혀진 땅', 'Desolace'],
      bosses: [
        B('Noxxion', 'Noxxion', ['쫄로 갈라집니다.', 'Splits into adds.']),
        B('Razorlash', 'Razorlash', ['순찰합니다.', 'Patrols.']),
        B('Lord Vyletongue', 'Lord Vyletongue', ['순간이동합니다.', 'Blinks around.']),
        B('Celebras the Cursed', 'Celebras the Cursed', ['쓰러뜨리면 퀘스트가 이어집니다.', 'Continues a quest when defeated.']),
        B('Landslide', 'Landslide', ['넉백이 강합니다.', 'Big knockback.']),
        B('Tinkerer Gizlock', 'Tinkerer Gizlock', ['폭탄을 던집니다.', 'Throws bombs.']),
        B('Rotgrip', 'Rotgrip', ['물속 악어입니다.', 'Water crocolisk.']),
        B('Princess Theradras', 'Princess Theradras', ['마지막 보스. 넉백과 광역 피해가 있으니 벽을 등지세요.', 'Final boss. Knockbacks and AoE; back to a wall.'])
      ]
    },
    {
      id: 'alcaz', ko: '알카즈 감옥', en: 'Alcaz Prison', min: 48, max: 53, zone: ['먼지진흙 습지대 알카즈 섬', 'Alcaz Island, Dustwallow Marsh'], isNew: true, beta: true,
      bosses: [B('Blazeroar', 'Blazeroar', null, { note: ['마지막 보스로 알려짐 (한 곳만 확인)', 'Reported final boss (one source)'] })],
      note: ['보스 구성이 대부분 공개되지 않았습니다.', 'Most bosses are not public yet.'],
      sources: [['wowforeverguides.com', 'https://wowforeverguides.com/dungeons/alcaz-prison']]
    },
    {
      id: 'st', ko: '아탈학카르 신전', en: 'Temple of Atal\'Hakkar', min: 50, max: 56, zone: ['슬픔의 늪', 'Swamp of Sorrows'],
      bosses: [
        B("Atal'alarion", "Atal'alarion", ['석상 순서를 맞춰 소환합니다.', 'Summoned by activating the statues in order.'], { opt: true }),
        B("Jammal'an the Prophet", "Jammal'an the Prophet", ['정신 지배와 치유를 씁니다.', 'Mind controls and heals.']),
        B('Ogom the Wretched', 'Ogom the Wretched', ['잠말란과 함께 나옵니다.', 'Fought with Jammal\'an.']),
        B('Morphaz', 'Morphaz', ['용 보스.', 'Dragon boss.']),
        B('Hazzas', 'Hazzas', ['용 보스.', 'Dragon boss.']),
        B('Shade of Eranikus', 'Shade of Eranikus', ['마지막 보스. 수면을 해제하세요.', 'Final boss. Dispel sleep.'])
      ]
    },
    {
      id: 'brd', ko: '검은바위 나락', en: 'Blackrock Depths', min: 52, max: 60, zone: ['검은바위 산', 'Blackrock Mountain'],
      bosses: [
        B('High Interrogator Gerstahn', 'High Interrogator Gerstahn', ['정신 비명(공포)을 겁니다.', 'Psychic Scream fear.']),
        B('Lord Roccor', 'Lord Roccor', ['지진 피해가 있습니다.', 'Earthquake damage.']),
        B('Houndmaster Grebmar', 'Houndmaster Grebmar', ['사냥개와 함께.', 'With hounds.']),
        B('Ring of Law', 'Ring of Law', ['투기장 이벤트. 무작위 보스가 나옵니다.', 'Arena event with random bosses.']),
        B('Pyromancer Loregrain', 'Pyromancer Loregrain', ['화염 마법사.', 'Fire caster.']),
        B('Lord Incendius', 'Lord Incendius', ['화염 넉백.', 'Fire knockback.']),
        B('General Angerforge', 'General Angerforge', ['체력이 줄면 부하를 부릅니다.', 'Calls guards at low health.']),
        B('Golem Lord Argelmach', 'Golem Lord Argelmach', ['골렘을 깨웁니다.', 'Awakens golems.']),
        B('Ambassador Flamelash', 'Ambassador Flamelash', ['정령이 몰려옵니다. 길목을 막으세요.', 'Elementals rush in; block their path.']),
        B('Magmus', 'Magmus', ['왕좌 앞 거대 정령. 불기둥을 피하세요.', 'Giant elemental before the throne; avoid the fire jets.']),
        B('Emperor Dagran Thaurissan', 'Emperor Dagran Thaurissan', ['마지막 보스. 공주 모이라를 살리려면 공주를 공격하지 마세요.', 'Final boss. Leave Princess Moira alone if you want her to live.'])
      ]
    },
    {
      id: 'blackmaw', ko: '검은아귀 요새', en: 'Blackmaw Hold', min: 55, max: 60, zone: ['아즈샤라 북부', 'Northern Azshara'], isNew: true, beta: true,
      bosses: [B('Varrox Bleakhoof', 'Varrox Bleakhoof')],
      note: ['보스 여러 명이 확인됐지만 이름은 한 명만 알려졌습니다.', 'Several bosses confirmed; only one is named so far.'],
      sources: [['realmfirst.net', 'https://realmfirst.net/world-of-warcraft-forever/dungeons-raids/dungeons/blackmaw-hold/']]
    },
    {
      id: 'lbrs', ko: '검은바위 첨탑 하층', en: 'Lower Blackrock Spire', min: 55, max: 60, zone: ['검은바위 산', 'Blackrock Mountain'],
      bosses: [
        B('Highlord Omokk', 'Highlord Omokk', ['오우거 무리와 함께.', 'With ogres.']),
        B("Shadow Hunter Vosh'gajin", "Shadow Hunter Vosh'gajin", ['저주를 겁니다.', 'Curses.']),
        B('War Master Voone', 'War Master Voone', ['투척 공격.', 'Throws weapons.']),
        B('Mother Smolderweb', 'Mother Smolderweb', ['거미 독.', 'Spider poison.']),
        B('Urok Doomhowl', 'Urok Doomhowl', ['깃발 이벤트로 소환.', 'Summoned with the banner event.'], { opt: true }),
        B('Quartermaster Zigris', 'Quartermaster Zigris', ['원거리 공격.', 'Ranged attacks.']),
        B('Halycon', 'Halycon', ['늑대 둥지.', 'Worg den.']),
        B('Gizrul the Slavener', 'Gizrul the Slavener', ['할리콘 뒤에 나옵니다.', 'Comes after Halycon.']),
        B('Overlord Wyrmthalak', 'Overlord Wyrmthalak', ['마지막 보스. 체력이 줄면 부하를 부릅니다.', 'Final boss. Calls adds at low health.'])
      ]
    },
    {
      id: 'direm', ko: '혈투의 전장', en: 'Dire Maul', min: 55, max: 60, zone: ['페랄라스', 'Feralas'],
      bosses: [
        B('Alzzin the Wildshaper', 'Alzzin the Wildshaper', ['동쪽 구역 마지막 보스.', 'East wing final boss.']),
        B('Immol\'thar', 'Immol\'thar', ['서쪽 구역. 수정탑을 먼저 끄세요.', 'West wing. Shut down the pylons first.']),
        B('Prince Tortheldrin', 'Prince Tortheldrin', ['서쪽 구역 마지막 보스.', 'West wing final boss.']),
        B('King Gordok', 'King Gordok', ['북쪽 구역 마지막 보스.', 'North wing final boss.'])
      ]
    },
    {
      id: 'shaper', ko: '조물주의 정원', en: "Shaper's Terrace", min: 58, max: 60, zone: ["운고로 분화구", "Un'Goro Crater"], isNew: true, beta: true,
      bosses: [B('Nanaya', 'Nanaya'), B('Cinder', 'Cinder'), B('Bolt', 'Bolt'), B('Snowtalon', 'Snowtalon')],
      note: ['베타 클라이언트 데이터의 보스 이름입니다. 공략은 출시 후 확인이 필요합니다.', 'Boss names from beta client data; tactics after launch.'],
      sources: [['wowforeverguides.com', 'https://wowforeverguides.com/dungeons/the-shapers-terrace'], ['mmonster', 'https://mmonster.co/wow-forever/guides/dungeons/shapers-terrace']]
    },
    {
      id: 'scholo', ko: '스칼로맨스', en: 'Scholomance', min: 58, max: 60, zone: ['서부 역병지대', 'Western Plaguelands'],
      bosses: [
        B('Kirtonos the Herald', 'Kirtonos the Herald', ['횃불로 소환합니다.', 'Summoned with the brazier.']),
        B('Jandice Barov', 'Jandice Barov', ['분신을 만듭니다. 진짜를 찾으세요.', 'Creates illusions; find the real one.']),
        B('Rattlegore', 'Rattlegore', ['강한 근접 공격.', 'Hard-hitting melee.']),
        B('Ras Frostwhisper', 'Ras Frostwhisper', ['서리 마법.', 'Frost caster.']),
        B('Instructor Malicia', 'Instructor Malicia', ['교실 보스.', 'Classroom boss.']),
        B('Darkmaster Gandling', 'Darkmaster Gandling', ['마지막 보스. 다른 방으로 순간이동시킵니다.', 'Final boss. Teleports players into other rooms.'])
      ]
    },
    {
      id: 'strat', ko: '스트라솔름', en: 'Stratholme', min: 58, max: 60, zone: ['동부 역병지대', 'Eastern Plaguelands'],
      bosses: [
        B('Timmy the Cruel', 'Timmy the Cruel', ['광장 근처에 나옵니다.', 'Appears near the square.']),
        B('Archivist Galford', 'Archivist Galford', ['살아있는 구역.', 'Live side.']),
        B('Balnazzar', 'Balnazzar', ['살아있는 구역 마지막 보스. 정신 지배를 조심하세요.', 'Live side final boss. Watch for Mind Control.']),
        B('Baroness Anastari', 'Baroness Anastari', ['언데드 구역. 빙의를 겁니다.', 'Undead side. Possesses players.']),
        B("Nerub'enkan", "Nerub'enkan", ['언데드 구역.', 'Undead side.']),
        B('Maleki the Pallid', 'Maleki the Pallid', ['언데드 구역.', 'Undead side.']),
        B('Ramstein the Gorger', 'Ramstein the Gorger', ['언데드 구역.', 'Undead side.']),
        B('Baron Rivendare', 'Baron Rivendare', ['언데드 구역 마지막 보스.', 'Undead side final boss.'])
      ]
    },
    {
      id: 'ubrs', ko: '검은바위 첨탑 상층', en: 'Upper Blackrock Spire', min: 58, max: 60, zone: ['검은바위 산', 'Blackrock Mountain'],
      bosses: [
        B('Pyroguard Emberseer', 'Pyroguard Emberseer', ['수행자를 모두 잡으면 깨어납니다.', 'Awakens after the incarcerators die.']),
        B('Solakar Flamewreath', 'Solakar Flamewreath', ['알 방 이벤트.', 'Rookery event.']),
        B('Warchief Rend Blackhand', 'Warchief Rend Blackhand', ['투기장 웨이브 뒤에 기스와 함께 나옵니다.', 'Comes with Gyth after the arena waves.']),
        B('The Beast', 'The Beast', ['화염 넉백과 공포.', 'Fire knockback and fear.']),
        B('General Drakkisath', 'General Drakkisath', ['마지막 보스. 호위병을 따로 탱하세요.', 'Final boss. Off-tank his guards.'])
      ]
    }
  ];
})();
