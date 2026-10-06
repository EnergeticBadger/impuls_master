// Building blocks for "what does the card do", so people can explore rules text without knowing regex.
// Magic abilities are modular: a trigger ("When this enters"), an effect ("destroy"), and who or what it hits ("target artifact").
// Each block is one ability; its pieces become a Scryfall regex like o:/when (~|this \w+) enters[^.]*destroy[^.]*target artifact/.

// the most useful Tagger tags (otag:), shown as chips; every other tag is a search away. All checked to return cards.
export const ROLES: { value: string, label: string }[] = [
    { value: 'removal', label: 'Removal' },
    { value: 'board-wipe', label: 'Board wipe' },
    { value: 'counterspell', label: 'Counterspell' },
    { value: 'draw', label: 'Card draw' },
    { value: 'card-advantage', label: 'Card advantage' },
    { value: 'ramp', label: 'Ramp' },
    { value: 'mana-rock', label: 'Mana rock' },
    { value: 'mana-dork', label: 'Mana dork' },
    { value: 'tutor', label: 'Tutor (search your library)' },
    { value: 'reanimate', label: 'Reanimate' },
    { value: 'recursion', label: 'Recursion' },
    { value: 'repeatable-token-generator', label: 'Makes tokens' },
    { value: 'sacrifice-outlet', label: 'Sacrifice outlet' },
    { value: 'lifegain', label: 'Lifegain' },
    { value: 'burn', label: 'Burn' },
    { value: 'mill', label: 'Mill' },
    { value: 'discard', label: 'Discard' },
    { value: 'bounce', label: 'Bounce' },
    { value: 'blink', label: 'Blink' },
    { value: 'protection', label: 'Protection' },
    { value: 'anthem', label: 'Anthem (pumps your team)' },
    { value: 'combat-trick', label: 'Combat trick' },
    { value: 'evasion', label: 'Evasion' },
    { value: 'graveyard-hate', label: 'Graveyard hate' },
    { value: 'clone', label: 'Clone' },
    { value: 'copy-spell', label: 'Copies spells' },
    { value: 'extra-turn', label: 'Extra turn' },
    { value: 'cantrip', label: 'Cantrip' },
]

// a tag's name as people read it: "removal-exile" → "removal exile", or the friendly chip label
export const roleLabel = (value: string) => ROLES.find((r) => r.value === value)?.label ?? value.replace(/-/g, ' ')

const isRole = (tag: string) => ROLES.some((r) => r.value === tag)

// the whole tag list is big, so it's only fetched once someone opens the builder
let allTags: Promise<string[]> | undefined
export const loadTags = () => allTags ??= import('./otags').then((m) => m.OTAGS)

// tags matching what's typed: whole-name starts first, then a word in the name starting with it, then anywhere
export function findTags(q: string, tags: readonly string[], limit = 8): string[] {
    const words = q.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean)
    if (!words.length) return []
    const slug = words.join('-')
    const score = (tag: string) => {
        const label = roleLabel(tag).toLowerCase()
        if (tag === slug) return 0
        if (tag.startsWith(slug) || label.startsWith(words.join(' '))) return 1
        const parts = `${tag} ${label}`.split(/[- ()]/)
        if (words.every((w) => parts.some((p) => p.startsWith(w)))) return 2
        if (words.every((w) => tag.includes(w) || label.includes(w))) return 3
        return 9
    }
    return [...new Set([...ROLES.map((r) => r.value), ...tags])]
        .map((tag) => [tag, score(tag)] as const)
        .filter(([, s]) => s < 9)
        // the common tags win a tie, then shorter (broader) names
        .sort((a, b) => a[1] - b[1] || +!isRole(a[0]) - +!isRole(b[0]) || a[0].length - b[0].length || a[0].localeCompare(b[0]))
        .slice(0, limit)
        .map(([tag]) => tag)
}

// "this card" in Oracle text: older cards use ~ for the name, newer ones say "this creature", "this artifact"…
const SELF = '(~|this \\w+)'

// group sorts the pieces into headings in the dropdown; hint is extra words the search box matches.
// re goes inside a bigger regex, so an alternation needs its own group, and groups may only nest two deep:
// Scryfall rejects or misreads `((a|(b))…)`
export type Piece = { value: string, label: string, re: string, group: string, hint?: string }

// when the ability happens
export const TRIGGERS: Piece[] = [
    { group: 'This card', value: 'enters', label: 'When this enters', re: `when(ever)? ${SELF} enters`, hint: 'etb comes into play' },
    { group: 'This card', value: 'dies', label: 'When this dies', re: `when(ever)? ${SELF} dies`, hint: 'death' },
    { group: 'This card', value: 'leaves', label: 'When this leaves the battlefield', re: `when(ever)? ${SELF} leaves the battlefield`, hint: 'ltb' },
    { group: 'This card', value: 'attacks', label: 'Whenever this attacks', re: `whenever ${SELF} attacks`, hint: 'combat' },
    { group: 'This card', value: 'enters-attacks', label: 'Whenever this enters or attacks', re: `whenever ${SELF} enters or attacks`, hint: 'etb combat' },
    { group: 'This card', value: 'combat-any', label: 'Whenever this attacks, blocks or deals damage', re: `whenever ${SELF} (attacks|blocks|becomes blocked|deals (combat )?damage)`, hint: 'combat any' },
    { group: 'This card', value: 'blocks', label: 'Whenever this blocks', re: `whenever ${SELF} blocks`, hint: 'combat' },
    { group: 'This card', value: 'attacks-blocks', label: 'Whenever this attacks or blocks', re: `whenever ${SELF} attacks or blocks`, hint: 'combat' },
    { group: 'This card', value: 'blocked', label: 'Whenever this becomes blocked', re: `whenever ${SELF} becomes blocked`, hint: 'combat' },
    { group: 'This card', value: 'combat-damage', label: 'Whenever this deals combat damage to a player', re: `whenever ${SELF} deals combat damage to (a player|an opponent)`, hint: 'saboteur hits connects' },
    { group: 'This card', value: 'deals-damage', label: 'Whenever this deals damage', re: `whenever ${SELF} deals (combat )?damage`, hint: 'hits' },
    { group: 'This card', value: 'dealt-damage', label: 'Whenever this is dealt damage', re: `whenever ${SELF} is dealt damage`, hint: 'enrage hurt' },
    { group: 'This card', value: 'targeted', label: 'Whenever this becomes the target of a spell', re: `whenever ${SELF} becomes the target`, hint: 'heroic targeted' },
    { group: 'This card', value: 'cast-self', label: 'When you cast this spell', re: 'when you cast this spell', hint: 'on cast' },
    { group: 'This card', value: 'cycle', label: 'When you cycle this', re: `when you cycle ${SELF}`, hint: 'cycling' },
    { group: 'This card', value: 'to-graveyard', label: 'When this is put into a graveyard from anywhere', re: `when ${SELF} is put into (a|your) graveyard`, hint: 'milled discarded' },
    { group: 'This card', value: 'transforms', label: 'When this transforms', re: `when(ever)? ${SELF} transforms( into)?`, hint: 'flip dfc' },

    // equipment and auras trigger off the creature they're attached to, not themselves
    { group: 'Equipped or enchanted creature', value: 'equipped-attacks', label: 'Whenever the equipped or enchanted creature attacks', re: 'whenever (equipped|enchanted) creature attacks', hint: 'equipment aura voltron combat' },
    { group: 'Equipped or enchanted creature', value: 'equipped-combat-damage', label: 'Whenever the equipped or enchanted creature deals combat damage', re: 'whenever (equipped|enchanted) creature deals (combat )?damage', hint: 'equipment aura voltron sword hits connects' },
    { group: 'Equipped or enchanted creature', value: 'equipped-dies', label: 'Whenever the equipped or enchanted creature dies', re: 'when(ever)? (equipped|enchanted) creature dies', hint: 'equipment aura death' },
    { group: 'Equipped or enchanted creature', value: 'becomes-attached', label: 'Whenever this becomes attached (equip)', re: `whenever ${SELF} becomes attached`, hint: 'equipment aura equip' },

    { group: 'Other things happen', value: 'other-enters', label: 'Whenever another creature enters', re: 'whenever [^.,]*(another|a|one or more) [^.,]*creatures?[^.,]* enters?\\b', hint: 'etb' },
    { group: 'Other things happen', value: 'yours-enters', label: 'Whenever a creature you control enters', re: 'whenever (another|a|one or more) (other )?(nontoken )?creatures? you control enters?', hint: 'etb your side' },
    { group: 'Other things happen', value: 'token-enters', label: 'Whenever a token enters', re: 'whenever [^.,]*tokens?[^.,]* enters?\\b', hint: 'etb' },
    { group: 'Other things happen', value: 'other-dies', label: 'Whenever a creature dies', re: 'whenever [^.,]*(another|a|one or more) [^.,]*creatures?[^.,]* dies?\\b', hint: 'death aristocrats' },
    { group: 'Other things happen', value: 'yours-dies', label: 'Whenever a creature you control dies', re: 'whenever (another|a|one or more) (other )?(nontoken )?creatures? you control dies?', hint: 'death aristocrats' },
    { group: 'Other things happen', value: 'opp-dies', label: "Whenever an opponent's creature dies", re: 'whenever (a|one or more) creatures? (an opponent controls|your opponents control) dies?', hint: 'death' },
    { group: 'Other things happen', value: 'landfall', label: 'Whenever a land enters (landfall)', re: 'whenever a land[^.,]* enters', hint: 'landfall' },
    { group: 'Other things happen', value: 'artifact-enters', label: 'Whenever an artifact enters', re: 'whenever [^.,]*artifacts?[^.,]* enters?\\b', hint: 'etb' },
    { group: 'Other things happen', value: 'enchantment-enters', label: 'Whenever an enchantment enters', re: 'whenever [^.,]*enchantments?[^.,]* enters?\\b', hint: 'constellation etb' },
    { group: 'Other things happen', value: 'your-attack', label: 'Whenever you attack', re: 'whenever (you attack|a creature you control attacks|one or more creatures you control attack)', hint: 'combat' },
    { group: 'Other things happen', value: 'sacrifice', label: 'Whenever you sacrifice something', re: 'whenever you sacrifice', hint: 'sac' },
    { group: 'Other things happen', value: 'counters-put', label: 'Whenever counters are put on something', re: 'whenever (one or more )?[^.,]*counters? (is|are) put on', hint: '+1/+1' },
    { group: 'Other things happen', value: 'leaves-graveyard', label: 'Whenever a card leaves your graveyard', re: 'whenever [^.,]*cards? leaves? your graveyard', hint: 'recursion' },
    { group: 'Other things happen', value: 'tapped-mana', label: 'Whenever something is tapped for mana', re: 'whenever [^.,]* is tapped for mana', hint: 'mana' },

    { group: 'You or opponents do something', value: 'cast', label: 'Whenever you cast a spell', re: 'whenever you cast', hint: 'spellcast' },
    { group: 'You or opponents do something', value: 'cast-creature', label: 'Whenever you cast a creature spell', re: 'whenever you cast a creature spell', hint: 'spellcast' },
    { group: 'You or opponents do something', value: 'cast-noncreature', label: 'Whenever you cast a noncreature spell', re: 'whenever you cast a noncreature spell', hint: 'prowess spellcast' },
    { group: 'You or opponents do something', value: 'cast-instant', label: 'Whenever you cast an instant or sorcery', re: 'whenever you cast an instant or sorcery', hint: 'magecraft spellslinger' },
    { group: 'You or opponents do something', value: 'opp-casts', label: 'Whenever an opponent casts a spell', re: 'whenever an opponent casts', hint: 'punish' },
    { group: 'You or opponents do something', value: 'gain-life', label: 'Whenever you gain life', re: 'whenever you gain life', hint: 'lifegain' },
    { group: 'You or opponents do something', value: 'lose-life', label: 'Whenever you lose life', re: 'whenever you lose life', hint: '' },
    { group: 'You or opponents do something', value: 'opp-loses-life', label: 'Whenever an opponent loses life', re: 'whenever an opponent loses life', hint: 'drain' },
    { group: 'You or opponents do something', value: 'draw', label: 'Whenever you draw a card', re: 'whenever you draw', hint: '' },
    { group: 'You or opponents do something', value: 'opp-draws', label: 'Whenever an opponent draws a card', re: 'whenever an opponent draws', hint: 'punish' },
    { group: 'You or opponents do something', value: 'discard', label: 'Whenever you discard a card', re: 'whenever you discard', hint: 'madness' },
    { group: 'You or opponents do something', value: 'scry', label: 'Whenever you scry or surveil', re: 'whenever you (scry|surveil)', hint: '' },
    { group: 'You or opponents do something', value: 'cycle-any', label: 'Whenever you cycle a card', re: 'whenever you cycle', hint: 'cycling' },

    { group: 'Each turn', value: 'upkeep', label: 'At the beginning of your upkeep', re: 'at the beginning of (your|each) upkeep', hint: 'every turn start' },
    { group: 'Each turn', value: 'opp-upkeep', label: "At the beginning of each opponent's upkeep", re: "at the beginning of each opponent's upkeep", hint: 'every turn' },
    { group: 'Each turn', value: 'draw-step', label: 'At the beginning of your draw step', re: 'at the beginning of (your|each) draw step', hint: 'every turn' },
    { group: 'Each turn', value: 'combat', label: 'At the beginning of combat', re: 'at the beginning of combat', hint: 'every turn' },
    { group: 'Each turn', value: 'main-phase', label: 'At the beginning of your main phase', re: 'at the beginning of (your|each) (precombat |first )?main phase', hint: 'every turn' },
    { group: 'Each turn', value: 'end-step', label: 'At the beginning of the end step', re: 'at the beginning of (your|each|the next) end step', hint: 'every turn end of turn' },

    { group: 'You choose to (activated abilities)', value: 'tap', label: 'Tap it: (an ability you activate)', re: '\\{t\\}[^:]*:', hint: 'activated tap ability' },
    { group: 'You choose to (activated abilities)', value: 'pay-mana', label: 'Pay mana: (an ability you activate)', re: '^\\{[^t}][^}]*\\}[^:]*:', hint: 'activated ability cost' },
    { group: 'You choose to (activated abilities)', value: 'sac-cost', label: 'Sacrifice something: (an ability you activate)', re: 'sacrifice [^:.]*:', hint: 'activated sac outlet' },
    { group: 'You choose to (activated abilities)', value: 'discard-cost', label: 'Discard a card: (an ability you activate)', re: 'discard [^:.]*:', hint: 'activated' },

    { group: 'Always on (static)', value: 'as-long-as', label: 'As long as… (while something is true)', re: 'as long as', hint: 'condition static' },
    { group: 'Always on (static)', value: 'if-you-control', label: 'If you control…', re: 'if you control', hint: 'condition' },
]

// equipment, auras and anthems say "has flying" or "have trample" where a one-shot effect says "gains"
const GIVES = '(gains?|has|have)'
const keywords = (...words: string[]) => `${GIVES} [^.]*\\b(${words.join('|')})`

// what the ability does. The broad ones come first: one pick covers every way of doing something,
// so people don't need a block per wording ("gets +2/+2", "+1/+1 counter", "has flying"…)
export const EFFECTS: Piece[] = [
    { group: 'Broad (any way of doing it)', value: 'any-bigger', label: 'make bigger: +X/+X or +X/+X counters', re: '\\+\\w+\\/\\+\\w+', hint: 'pump buff boost grow power toughness counters anthem equipment' },
    { group: 'Broad (any way of doing it)', value: 'any-smaller', label: 'make smaller: -X/-X or -X/-X counters', re: '-\\w+\\/-\\w+', hint: 'shrink wither weaken power toughness counters' },
    { group: 'Broad (any way of doing it)', value: 'any-removal', label: 'remove it: destroy, exile, damage, bounce, edict…', re: "(\\bdestroy|\\bexile|deals? [^.]*damage|-\\w+\\/-\\w+|\\bfights?\\b|return[^.]*to (its|their) owner'?s'? hands?|sacrifices|into its owner's library)", hint: 'kill removal answer' },
    { group: 'Broad (any way of doing it)', value: 'any-keyword', label: 'give a keyword: flying, trample, lifelink…', re: keywords('flying', 'first strike', 'double strike', 'deathtouch', 'haste', 'hexproof', 'indestructible', 'lifelink', 'menace', 'reach', 'trample', 'vigilance', 'ward', 'shroud', 'protection'), hint: 'keyword ability grant' },
    { group: 'Broad (any way of doing it)', value: 'any-evasion', label: 'make it hard to block: flying, menace, unblockable…', re: `(${keywords('flying', 'menace', 'trample', 'shadow', 'fear', 'intimidate', 'skulk', 'horsemanship')}|can't be blocked)`, hint: 'evasion unblockable' },
    { group: 'Broad (any way of doing it)', value: 'any-protection', label: 'protect it: hexproof, indestructible, ward, phasing…', re: `(${keywords('hexproof', 'shroud', 'indestructible', 'protection', 'ward')}|phases? out|\\bregenerate|prevent [^.]*damage)`, hint: 'protection save' },
    { group: 'Broad (any way of doing it)', value: 'any-cards', label: 'get more cards: draw, or play cards from exile', re: '(\\bdraws? \\w+ cards?|exile the top[^.]*(\\. [^.]*)?you may (play|cast)|look at the top[^.]*into your hand)', hint: 'card advantage impulse' },
    { group: 'Broad (any way of doing it)', value: 'any-graveyard', label: 'use a graveyard: return or cast cards from it', re: "(return|cast|play)[^.]*from (your|a|an opponent's) graveyard", hint: 'reanimate recursion flashback' },
    { group: 'Broad (any way of doing it)', value: 'any-mana', label: 'get more mana: add mana, Treasure, lands, cheaper spells', re: '(add \\{|create[^.]*treasure|put [^.]*lands? cards?[^.]* onto the battlefield|play an additional land|costs? (\\{\\w\\} |\\w+ )?less)', hint: 'ramp fixing cost reducer' },
    { group: 'Broad (any way of doing it)', value: 'any-hurt', label: 'hurt players: damage or life loss', re: '(loses? (\\w+ )?life|deals? [^.]*damage to [^.]*(player|opponent|any target))', hint: 'burn drain ping face' },
    { group: 'Broad (any way of doing it)', value: 'any-counters', label: 'put counters of any kind', re: 'put[^.]*counters? on', hint: '+1/+1 loyalty charge proliferate' },
    { group: 'Broad (any way of doing it)', value: 'any-lockdown', label: "lock it down: tap, can't attack, block or cast", re: "(\\btap (target|up to|another|each|all)|doesn't untap|can't (attack|block|cast|be cast|activate))", hint: 'stax tempo pacifism' },

    { group: 'Cards', value: 'draw', label: 'draw cards', re: '\\bdraws? \\w+ cards?', hint: 'card advantage' },
    { group: 'Cards', value: 'draw-then-discard', label: 'draw, then discard (loot)', re: 'draws? [^.]*then discards?', hint: 'loot rummage filter' },
    { group: 'Cards', value: 'look-top', label: 'look at the top cards of a library', re: 'look at the top', hint: 'dig' },
    { group: 'Cards', value: 'impulse', label: 'exile the top card and let you play it', re: 'exile the top[^.]*(\\. [^.]*)?you may (play|cast)', hint: 'impulse draw' },
    { group: 'Cards', value: 'tutor', label: 'search your library', re: 'search your library', hint: 'tutor find' },
    { group: 'Cards', value: 'scry', label: 'scry or surveil', re: '\\b(scry|surveil)', hint: 'filter' },
    { group: 'Cards', value: 'mill', label: 'mill cards', re: '\\bmills?', hint: 'self mill graveyard' },
    { group: 'Cards', value: 'discard', label: 'make someone discard', re: 'discards?', hint: 'hand attack' },
    { group: 'Cards', value: 'return-graveyard', label: 'bring something back from a graveyard', re: "return[^.]*from (your|a|an opponent's) graveyard", hint: 'reanimate recursion raise dead' },
    { group: 'Cards', value: 'cast-free', label: 'cast something without paying its mana cost', re: 'without paying its mana cost', hint: 'free cascade' },
    { group: 'Cards', value: 'cast-graveyard', label: 'cast something from a graveyard', re: 'cast [^.]*from (your|a|an opponent\'s) graveyard', hint: 'flashback recursion' },

    { group: 'Removal', value: 'destroy', label: 'destroy something', re: '\\bdestroy', hint: 'kill removal' },
    { group: 'Removal', value: 'exile', label: 'exile something', re: '\\bexile', hint: 'removal' },
    { group: 'Removal', value: 'damage', label: 'deal damage', re: 'deals? [^.]*damage', hint: 'burn ping' },
    { group: 'Removal', value: 'shrink', label: 'give -X/-X', re: 'gets? -\\w+\\/-\\w+', hint: 'shrink kill' },
    { group: 'Removal', value: 'minus-counters', label: 'put -1/-1 counters', re: '-1\\/-1 counters?', hint: 'wither' },
    { group: 'Removal', value: 'fight', label: 'make creatures fight', re: '\\bfights?\\b', hint: 'removal' },
    { group: 'Removal', value: 'bounce', label: "return something to its owner's hand", re: "return[^.]*to (its|their) owner'?s'? hands?", hint: 'bounce tempo' },
    { group: 'Removal', value: 'opp-sacrifice', label: 'make an opponent sacrifice', re: '(each opponent|target (player|opponent)|each player) sacrifices', hint: 'edict' },
    { group: 'Removal', value: 'counter', label: 'counter a spell', re: 'counter target', hint: 'counterspell' },
    { group: 'Removal', value: 'steal', label: 'gain control of something', re: 'gain control of', hint: 'steal threaten' },
    { group: 'Removal', value: 'tuck', label: "put something into its owner's library", re: "into its owner's library", hint: 'tuck' },

    { group: 'Creatures & combat', value: 'counters', label: 'put +1/+1 (or any +X/+X) counters', re: '\\+\\w+\\/\\+\\w+ counters?', hint: 'grow power toughness' },
    { group: 'Creatures & combat', value: 'pump', label: 'give +X/+X (pump, equipment, anthem)', re: 'gets? \\+\\w+\\/\\+\\w+', hint: 'pump buff anthem power toughness' },
    { group: 'Creatures & combat', value: 'flying', label: 'give flying', re: keywords('flying'), hint: 'evasion keyword' },
    { group: 'Creatures & combat', value: 'trample', label: 'give trample', re: keywords('trample'), hint: 'keyword' },
    { group: 'Creatures & combat', value: 'haste', label: 'give haste', re: keywords('haste'), hint: 'keyword' },
    { group: 'Creatures & combat', value: 'indestructible', label: 'give indestructible', re: keywords('indestructible'), hint: 'protection keyword' },
    { group: 'Creatures & combat', value: 'hexproof', label: 'give hexproof or shroud', re: keywords('hexproof', 'shroud'), hint: 'protection keyword' },
    { group: 'Creatures & combat', value: 'unblockable', label: "make something unblockable", re: "can't be blocked", hint: 'evasion' },
    { group: 'Creatures & combat', value: 'cant-block', label: "stop creatures from blocking", re: "can't block", hint: '' },
    { group: 'Creatures & combat', value: 'extra-combat', label: 'give an extra combat', re: 'additional combat phase', hint: '' },
    { group: 'Creatures & combat', value: 'tap', label: 'tap or untap something', re: '\\b(tap|untap) (target|up to|another|each|all)', hint: '' },
    { group: 'Creatures & combat', value: 'phase', label: 'phase something out', re: 'phases? out', hint: 'protection' },
    { group: 'Creatures & combat', value: 'goad', label: 'goad a creature', re: '\\bgoads?\\b', hint: 'politics' },
    { group: 'Creatures & combat', value: 'prevent', label: 'prevent damage', re: 'prevent [^.]*damage', hint: 'fog' },

    { group: 'Tokens & copies', value: 'token', label: 'create tokens', re: 'create[^.]*tokens?', hint: 'go wide' },
    { group: 'Tokens & copies', value: 'treasure', label: 'create Treasure', re: 'create[^.]*treasure', hint: 'ramp token' },
    { group: 'Tokens & copies', value: 'food', label: 'create Food', re: 'create[^.]*food', hint: 'token' },
    { group: 'Tokens & copies', value: 'clue', label: 'create a Clue (investigate)', re: '(create[^.]*clue|investigate)', hint: 'token draw' },
    { group: 'Tokens & copies', value: 'copy', label: 'copy something', re: '\\bcopy', hint: 'clone' },
    { group: 'Tokens & copies', value: 'becomes-copy', label: 'become a copy of something', re: 'becomes? a copy', hint: 'clone' },
    { group: 'Tokens & copies', value: 'double', label: 'double something', re: '(\\bdoubles?\\b|twice that many)', hint: 'doubling' },

    { group: 'Life', value: 'gain-life', label: 'gain life', re: 'gains? \\w+ life', hint: 'lifegain' },
    { group: 'Life', value: 'lose-life', label: 'make someone lose life', re: 'loses? \\w+ life', hint: 'drain' },
    { group: 'Life', value: 'drain', label: 'drain (they lose, you gain)', re: 'loses? \\w+ life and you gain', hint: 'drain' },

    { group: 'Mana & lands', value: 'mana', label: 'add mana', re: 'add \\{', hint: 'ramp' },
    { group: 'Mana & lands', value: 'any-color', label: 'add mana of any color', re: 'mana of any (one )?colou?r', hint: 'fixing' },
    { group: 'Mana & lands', value: 'land-to-battlefield', label: 'put a land onto the battlefield', re: 'put [^.]*lands? cards?[^.]* onto the battlefield', hint: 'ramp' },
    { group: 'Mana & lands', value: 'extra-land', label: 'play an extra land', re: 'play an additional land', hint: 'ramp' },
    { group: 'Mana & lands', value: 'cost-less', label: 'make spells cost less', re: 'costs? (\\{\\w\\} |\\w+ )?less', hint: 'cost reducer' },
    { group: 'Mana & lands', value: 'cost-more', label: 'make spells cost more', re: 'costs? (\\{\\w\\} |\\w+ )?more', hint: 'tax' },

    { group: 'Everything else', value: 'sacrifice', label: 'sacrifice something', re: 'sacrifices?', hint: '' },
    { group: 'Everything else', value: 'proliferate', label: 'proliferate', re: '\\bproliferate', hint: 'counters' },
    { group: 'Everything else', value: 'monarch', label: 'make someone the monarch', re: 'becomes? the monarch', hint: '' },
    { group: 'Everything else', value: 'initiative', label: 'take the initiative', re: 'take the initiative', hint: 'dungeon' },
    { group: 'Everything else', value: 'cant-cast', label: "stop players casting or doing things", re: "can't cast", hint: 'stax hate' },
    { group: 'Everything else', value: 'extra-turn', label: 'take an extra turn', re: 'extra turn', hint: '' },
    { group: 'Everything else', value: 'win', label: 'win or lose the game', re: '(wins?|loses?) the game', hint: 'alternate win' },
    { group: 'Everything else', value: 'transform', label: 'transform', re: '\\btransform', hint: 'flip dfc' },
    { group: 'Everything else', value: 'shuffle', label: 'shuffle', re: '\\bshuffles?\\b', hint: '' },
]

// who or what the ability happens to; free words work too
export const TARGETS: Piece[] = [
    { group: 'Creatures', value: 'target creature', label: 'target creature', re: 'target creature', hint: 'single' },
    { group: 'Creatures', value: 'creature you control', label: 'a creature you control', re: 'creatures? you control', hint: 'your own' },
    { group: 'Creatures', value: 'opponent creature', label: "a creature an opponent controls", re: '(creatures? (an opponent controls|your opponents control|you don\'t control))', hint: 'theirs' },
    { group: 'Creatures', value: 'each creature', label: 'each or all creatures', re: '(each|all) (other )?creatures?', hint: 'sweeper wipe' },
    { group: 'Creatures', value: 'attacking creature', label: 'an attacking or blocking creature', re: '(attacking|blocking) creatures?', hint: 'combat' },
    { group: 'Creatures', value: 'equipped creature', label: 'the equipped or enchanted creature', re: '(equipped|enchanted) creatures?', hint: 'equipment aura voltron' },
    { group: 'Creatures', value: 'token', label: 'a token', re: 'tokens?', hint: '' },
    { group: 'Other permanents', value: 'target artifact', label: 'an artifact', re: 'artifacts?', hint: '' },
    { group: 'Other permanents', value: 'target enchantment', label: 'an enchantment', re: 'enchantments?', hint: '' },
    { group: 'Other permanents', value: 'target land', label: 'a land', re: 'lands?', hint: '' },
    { group: 'Other permanents', value: 'target planeswalker', label: 'a planeswalker', re: 'planeswalkers?', hint: '' },
    { group: 'Other permanents', value: 'nonland permanent', label: 'a nonland permanent', re: 'nonland permanents?', hint: 'anything' },
    { group: 'Other permanents', value: 'permanent', label: 'any permanent', re: 'permanents?', hint: '' },
    { group: 'Players', value: 'you', label: 'you', re: '\\byou\\b', hint: 'yourself' },
    { group: 'Players', value: 'target player', label: 'target player', re: 'target player', hint: '' },
    { group: 'Players', value: 'target opponent', label: 'target opponent', re: 'target opponent', hint: '' },
    { group: 'Players', value: 'each opponent', label: 'each opponent', re: 'each opponent', hint: 'multiplayer group' },
    { group: 'Players', value: 'each player', label: 'each player', re: 'each player', hint: 'symmetric group' },
    { group: 'Zones', value: 'spell', label: 'a spell', re: 'spells?', hint: 'stack' },
    { group: 'Zones', value: 'graveyard', label: 'a graveyard', re: 'graveyards?', hint: '' },
    { group: 'Zones', value: 'hand', label: 'a hand', re: 'hands?', hint: '' },
    { group: 'Zones', value: 'library', label: 'a library', re: 'library', hint: 'deck' },
]

// one ability: any of the three parts can be left out, but not all of them.
// words is who/what it hits: one of TARGETS by value, or the person's own words
export type RuleBlock = { trigger: string, effect: string, words: string }

export const emptyBlock = (): RuleBlock => ({ trigger: '', effect: '', words: '' })

const escape = (s: string) => s.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&')

// the pieces of a block that are filled in
function parts(b: RuleBlock) {
    const trigger = TRIGGERS.find((t) => t.value === b.trigger)
    const effect = EFFECTS.find((e) => e.value === b.effect)
    const words = b.words.trim()
    const target = TARGETS.find((t) => t.value === words.toLowerCase() || t.label === words.toLowerCase())
    return { trigger, effect, words, target }
}

// one block as Scryfall syntax; the pieces have to appear in one sentence, the trigger before the effect.
// who/what can sit either side of the effect ("destroy target creature", "target player draws two cards")
export function blockToken(b: RuleBlock): string {
    const { trigger, effect, words, target } = parts(b)
    const what = target?.re ?? (words && escape(words.toLowerCase()))
    if (!trigger && !effect) {
        if (!what) return ''
        // plain words on their own don't need a regex
        if (!target) return /[\s()]/.test(words) ? `o:"${words.replace(/"/g, '')}"` : `o:${words.replace(/"/g, '')}`
        return `o:/${what}/`
    }
    const orders = effect && what ? [[trigger?.re, effect.re, what], [trigger?.re, what, effect.re]] : [[trigger?.re, effect?.re ?? what]]
    // the two orders sit side by side at the top level: wrapping them in a group would add a level, and
    // Scryfall rejects or misreads groups nested three deep
    const regexes = pack(orders.flatMap((o) => fit(o.filter((p): p is string => !!p))))
    return regexes.length > 1 ? `(${regexes.map((r) => `o:/${r}/`).join(' or ')})` : `o:/${regexes[0]}/`
}

// Scryfall ignores a regex longer than this, so a long block is split into several, joined with `or`
const MAX_REGEX = 248

// one sentence's pieces as regexes short enough for Scryfall: if they're too long together, the longest
// piece's biggest alternation is halved and each half tried on its own. X(a|b)Y finds the same cards as X(a)Y or X(b)Y
function fit(pieces: string[]): string[] {
    const re = pieces.join('[^.]*')
    if (re.length <= MAX_REGEX) return [re]
    const i = pieces.reduce((longest, p, n) => p.length > pieces[longest].length ? n : longest, 0)
    const halves = halve(pieces[i])
    // nothing left to split: send it anyway and let Scryfall say so
    if (!halves) return [re]
    return halves.flatMap((h) => fit(pieces.map((p, n) => n === i ? h : p)))
}

// regexes that fit together go back into one, so the query stays as short as it can
function pack(regexes: string[]): string[] {
    const packed: string[] = []
    for (const r of regexes) {
        const last = packed.at(-1)
        if (last !== undefined && last.length + 1 + r.length <= MAX_REGEX) packed[packed.length - 1] = `${last}|${r}`
        else packed.push(r)
    }
    return packed
}

// the regex's biggest alternation cut in two: a(b|c|d) → a(b|c) and a(d); null when it has none
function halve(re: string): [string, string] | null {
    const open: { start: number, bars: number[] }[] = []
    let best: { start: number, bars: number[], end: number } | undefined
    let inClass = false
    for (let i = 0; i < re.length; i++) {
        const ch = re[i]
        if (ch === '\\') i++
        else if (inClass) inClass = ch !== ']'
        else if (ch === '[') inClass = true
        else if (ch === '(') open.push({ start: i, bars: [] })
        else if (ch === '|') open.at(-1)?.bars.push(i)
        else if (ch === ')') {
            const group = open.pop()
            if (group?.bars.length && group.bars.length > (best?.bars.length ?? 0)) best = { ...group, end: i }
        }
    }
    if (!best) return null
    const cuts = [best.start, ...best.bars, best.end]
    const options = cuts.slice(1).map((cut, n) => re.slice(cuts[n] + 1, cut))
    const half = Math.ceil(options.length / 2)
    const { start, end } = best
    const keep = (list: string[]) => `${re.slice(0, start + 1)}${list.join('|')}${re.slice(end)}`
    return [keep(options.slice(0, half)), keep(options.slice(half))]
}

// one block as a sentence: "When this enters → destroy something → target creature"
export function blockSentence(b: RuleBlock): string {
    const { trigger, effect, words, target } = parts(b)
    const what = target?.label ?? words
    if (!trigger && !effect) return what ? `mentions “${what}”` : ''
    const does = effect ? (trigger ? `→ ${effect.label}` : `Can ${effect.label}`) : ''
    const head = [trigger?.label, does].filter(Boolean).join(' ')
    return what ? `${head} → ${target ? what : `“${what}”`}` : head
}

// pieces matching what's typed, best first; every typed word has to start a word of the piece. An empty search lists them all
export function findPieces(q: string, pieces: readonly Piece[]): Piece[] {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (!words.length) return [...pieces]
    const starts = (text: string) => words.every((w) => text.split(/[^a-z0-9+'/-]+/).some((t) => t.startsWith(w)))
    return pieces
        .map((p) => {
            const label = p.label.toLowerCase()
            const score = label.includes(words.join(' ')) ? 0 : starts(label) ? 1 : starts(`${label} ${p.hint ?? ''} ${p.group.toLowerCase()}`) ? 2 : 9
            return [p, score] as const
        })
        .filter(([, s]) => s < 9)
        .sort((a, b) => a[1] - b[1])
        .map(([p]) => p)
}
