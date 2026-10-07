/*
 * SugarCube context-writing macro semantics.
 *
 * The structural guard needs to know which macros *write* pronoun / NPC
 * context and what each of them reads, writes, and outputs. A translation that
 * swaps one of these macros for another (or moves it across a branch) is only
 * safe when the two resolve to the same behavioural signature.
 *
 * This is the structural subset of the game's context-selector family. It is
 * deliberately limited to signature data + pure lookup helpers used by
 * `protect.mjs` and `protection-v3.mjs`; it contains no display layer, no batch
 * tooling, and nothing related to translation production.
 */

const SELECTOR_READS = ['$NPCList', '$npcrow', '$npcnum', '$NPCName'];
const SELECTOR_WRITES = ['$index', '$npcadult', '$pronoun', '$description', '$role', '$npc_named'];

const PERSONSELECT = {
  id: 'personselect',
  reads: SELECTOR_READS,
  writes: SELECTOR_WRITES,
  writePersistence: 'passage-context',
  argumentSemantics: 'npc-index-or-"tentacles"',
  branchSemantics: 'writes $index before the NPC check; on a missing NPC raises <<error>> and writes nothing else',
  outputRole: 'none',
};

const PERSONSELECT_FIXED = {
  ...PERSONSELECT,
  id: 'personselect-fixed',
  argumentSemantics: 'fixed-npc-index-0|1|2',
};

const HISSELECT = {
  id: 'hisselect',
  reads: [...SELECTOR_READS, '$enemytype', '$enemyno', '$npc', '$NPCList[_n].intro', '$NPCList[_n].name_known'],
  writes: [...SELECTOR_WRITES, '$NPCList[_n].intro'],
  writePersistence: 'passage-context; $NPCList[_n].intro is persistent NPC state in the combat branch',
  argumentSemantics: 'npc-index',
  branchSemantics:
    'combat (enemytype=man and enemyno>=2) selects the NPC and clears intro; beast uses the beast possessive; otherwise reuses the current pronoun context',
  outputRole: 'possessive',
};

const SOMEONE = {
  id: 'someone',
  reads: SELECTOR_READS,
  writes: ['$_target', ...SELECTOR_WRITES],
  writePersistence: 'passage-context',
  argumentSemantics: 'optional-npc-index',
  branchSemantics: 'with an argument selects that NPC; without one reuses the current pronoun context',
  outputRole: 'pronoun-object',
};

const SOMEONES = {
  id: 'someones',
  reads: [...HISSELECT.reads],
  writes: ['$_target', ...SELECTOR_WRITES, '$NPCList[_n].intro'],
  writePersistence: 'passage-context; $NPCList[_n].intro is persistent NPC state in the combat branch',
  argumentSemantics: 'optional-npc-index-or-"two"',
  branchSemantics: '"two" prints the plural possessive; an index defers to hisselect; otherwise reuses the current context',
  outputRole: 'possessive',
};

const THEIR = {
  ...SOMEONES,
  id: 'their',
  argumentSemantics: 'optional-npc-index',
  branchSemantics: 'an index defers to hisselect; otherwise plural-man combat prints the plural possessive, else the current context',
};

const BHIS = {
  id: 'bhis',
  reads: ['$NPCList', '$beastGroupFight', '$combat', '$enemyno', '_n'],
  writes: [],
  writePersistence: 'none',
  argumentSemantics: 'optional-npc-index',
  branchSemantics: 'beast possessive resolved from the beast NPC; no context writes',
  outputRole: 'possessive',
};

const PERSON = {
  id: 'person',
  reads: ['$index', '$description', '$NPCList[$index].type', '$npc_named', '$role', '$pronoun', '$npcadult'],
  writes: ['$index'],
  writePersistence: 'passage-context; $index is reset only when it already equals "tentacles"',
  argumentSemantics: 'optional-"normal"',
  branchSemantics: 'type / npc_named / role / m / f / other-pronoun / error, in the original order',
  outputRole: 'noun-phrase',
};

const PERSONS = {
  ...PERSON,
  id: 'persons',
  writes: ['$index'],
  branchSemantics: 'delegates to person, then appends the possessive marker',
  outputRole: 'possessive',
};

const PERSONSIMPLE = {
  ...PERSON,
  id: 'personsimple',
  writes: [],
  writePersistence: 'none',
  branchSemantics: 'type / role / m / f / other-pronoun / error, in the original order; no description, no writes',
};

/** original macro -> signature (scoped `dolp_*` helpers share the base signature). */
export const CONTEXT_SIGNATURES = {
  personselect: PERSONSELECT,
  person1: PERSONSELECT_FIXED,
  person2: PERSONSELECT_FIXED,
  person3: PERSONSELECT_FIXED,
  someone: SOMEONE,
  someones: SOMEONES,
  their: THEIR,
  hisselect: HISSELECT,
  bhis: BHIS,
  person: PERSON,
  persons: PERSONS,
  personsimple: PERSONSIMPLE,
  // scoped helpers
  dolp_personselect: PERSONSELECT,
  dolp_person1: PERSONSELECT_FIXED,
  dolp_person2: PERSONSELECT_FIXED,
  dolp_person3: PERSONSELECT_FIXED,
  dolp_someone: SOMEONE,
  dolp_someones: SOMEONES,
  dolp_their: THEIR,
  dolp_hisselect: HISSELECT,
  dolp_bhis: BHIS,
  dolp_person: PERSON,
  dolp_persons: PERSONS,
  dolp_personsimple: PERSONSIMPLE,
};

/** Macros that *write* context and therefore need an explicit signature declaration. */
export const CONTEXT_WRITING_MACROS = new Set(
  Object.entries(CONTEXT_SIGNATURES)
    .filter(([name, sig]) => !name.startsWith('dolp_') && sig.writes.length > 0)
    .map(([name]) => name),
);

export function signatureOf(name) {
  return CONTEXT_SIGNATURES[String(name || '').toLowerCase()] || null;
}

/** Two signatures are equivalent when every behavioural field matches. */
export function equivalentSignatures(a, b) {
  if (!a || !b) return false;
  const fields = ['id', 'writePersistence', 'argumentSemantics', 'branchSemantics', 'outputRole'];
  for (const f of fields) if (a[f] !== b[f]) return false;
  const sameSet = (x, y) => x.length === y.length && [...x].sort().join('\u0000') === [...y].sort().join('\u0000');
  return sameSet(a.reads, b.reads) && sameSet(a.writes, b.writes);
}
