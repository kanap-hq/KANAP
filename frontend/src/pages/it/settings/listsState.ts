import type {
  ConnectionTypeOption,
  DomainOption,
  ItOpsEnumOption,
  ItOpsSettings,
  SubnetOption,
} from '../../../services/itOpsSettings';
import { stripLocalIds, withLocalIds } from './editorParts';

/**
 * The lists of the IT landscape settings page, as the page edits them: in the order they are
 * stored (no sort), each row with a local id for the editors. The page saves one list at a time;
 * only the list sent is reconciled with the server's answer.
 */

export type EnumListId =
  | 'adminZones'
  | 'applicationCategories'
  | 'dataClasses'
  | 'networkSegments'
  | 'entities'
  | 'serverKinds'
  | 'serverProviders'
  | 'serverRoles'
  | 'hostingTypes'
  | 'lifecycleStates'
  | 'interfaceProtocols'
  | 'interfaceDataCategories'
  | 'interfaceTriggerTypes'
  | 'interfacePatterns'
  | 'interfaceFormats'
  | 'interfaceAuthModes'
  | 'ipAddressTypes'
  | 'accessMethods'
  | 'incidentCategories'
  | 'technologyFamilies';

export type ListId = EnumListId | 'connectionTypes' | 'subnets' | 'domains';

export const enumListIds: EnumListId[] = [
  'adminZones', 'applicationCategories', 'dataClasses', 'networkSegments', 'entities', 'serverKinds',
  'serverProviders', 'serverRoles', 'hostingTypes', 'lifecycleStates', 'interfaceProtocols',
  'interfaceDataCategories', 'interfaceTriggerTypes', 'interfacePatterns', 'interfaceFormats',
  'interfaceAuthModes', 'ipAddressTypes', 'accessMethods', 'incidentCategories', 'technologyFamilies',
];

const emptyEnums = enumListIds.reduce((acc, id) => ({ ...acc, [id]: [] }), {} as Record<EnumListId, ItOpsEnumOption[]>);

export type SettingsState = {
  enums: Record<EnumListId, ItOpsEnumOption[]>;
  connectionTypes: ConnectionTypeOption[];
  subnets: SubnetOption[];
  domains: DomainOption[];
  /** The settings as stored: the last answer of the server. */
  baseline: ItOpsSettings | null;
  /** Lists whose rows differ from the stored ones. */
  dirty: Partial<Record<ListId, boolean>>;
};

export const initialState: SettingsState = {
  enums: emptyEnums,
  connectionTypes: [],
  subnets: [],
  domains: [],
  baseline: null,
  dirty: {},
};

export type Action =
  | { type: 'hydrate'; payload: ItOpsSettings }
  | { type: 'setList'; id: ListId; items: any[] }
  /** A refused save: the list shows its stored rows again. */
  | { type: 'revertList'; id: ListId }
  /** `sent`: the rows sent, with their local ids, in the order sent. */
  | { type: 'saved'; id: ListId; sent: any[]; saved: ItOpsSettings };

const idPrefix: Partial<Record<ListId, string>> = { connectionTypes: 'ct', subnets: 'subnet', domains: 'domain' };

function storedRows(settings: ItOpsSettings | null, id: ListId): any[] {
  return ((settings as any)?.[id] as any[] | undefined) || [];
}

function withRows(state: SettingsState, id: ListId, rows: any[]): SettingsState {
  if (id === 'connectionTypes') return { ...state, connectionTypes: rows };
  if (id === 'subnets') return { ...state, subnets: rows };
  if (id === 'domains') return { ...state, domains: rows };
  return { ...state, enums: { ...state.enums, [id]: rows } };
}

export function listRows(state: SettingsState, id: ListId): any[] {
  if (id === 'connectionTypes') return state.connectionTypes;
  if (id === 'subnets') return state.subnets;
  if (id === 'domains') return state.domains;
  return state.enums[id as EnumListId] || [];
}

/** What a person types in a row (selects and boxes keep their defaults). A new row with none of it is blank. */
const TYPED_FIELDS = ['label', 'cidr', 'typicalPorts', 'description', 'admin_group', 'dns_suffix', 'forest', 'vlan_number', 'account_count', 'machine_count'];

/** A row added and left empty: never sent, and gone once the page is left. */
export function isBlankRow(id: ListId, row: any): boolean {
  const fields = id === 'connectionTypes' ? [...TYPED_FIELDS, 'category'] : TYPED_FIELDS;
  return !row.code && fields.every((key) => row[key] === undefined || row[key] === null || String(row[key]).trim() === '');
}

/** The rows a save of the list sends: all but the blank ones. */
export function sendableRows(state: SettingsState, id: ListId): any[] {
  return listRows(state, id).filter((row) => !isBlankRow(id, row));
}

/** The rows, blank ones aside, are those stored. */
export function sameAsStored(state: SettingsState, id: ListId, rows: any[]): boolean {
  return JSON.stringify(stripLocalIds(rows)) === JSON.stringify(storedRows(state.baseline, id));
}

export function reducer(state: SettingsState, action: Action): SettingsState {
  switch (action.type) {
    case 'hydrate': {
      let next: SettingsState = { ...state, baseline: action.payload, dirty: {} };
      for (const id of [...enumListIds, 'connectionTypes', 'subnets', 'domains'] as ListId[]) {
        next = withRows(next, id, withLocalIds(storedRows(action.payload, id), idPrefix[id] ?? id));
      }
      return next;
    }
    case 'setList': {
      const kept = action.items.filter((row) => !isBlankRow(action.id, row));
      const dirty = action.items.length !== kept.length || !sameAsStored(state, action.id, kept);
      return { ...withRows(state, action.id, action.items), dirty: { ...state.dirty, [action.id]: dirty } };
    }
    case 'revertList': {
      if (!state.baseline) return state;
      const rows = withLocalIds(storedRows(state.baseline, action.id), idPrefix[action.id] ?? action.id);
      return { ...withRows(state, action.id, rows), dirty: { ...state.dirty, [action.id]: false } };
    }
    case 'saved': {
      // A row sent is matched to the saved one by its code; a new row by the name it was sent with,
      // among the values the server coded (a subnet by its place: subnets keep the order sent). A row
      // changed since the send keeps its edits and only learns its code.
      const savedList = storedRows(action.saved, action.id);
      const sentCodes = new Set(action.sent.map((row) => row.code).filter(Boolean));
      const coded = savedList.filter((row) => !row.code || !sentCodes.has(row.code));
      const taken = new Set<any>();
      const matchOf = (sent: any, index: number) => {
        if (action.id === 'subnets') return savedList[index];
        if (sent.code) return savedList.find((row) => row.code === sent.code);
        const name = String(sent.label ?? '').trim();
        const match = coded.find((row) => !taken.has(row) && row.label === name) ?? coded.find((row) => !taken.has(row));
        if (match) taken.add(match);
        return match;
      };
      const sentIndex = new Map(action.sent.map((row, index) => [row.localId, index]));
      const strip = (row: any) => JSON.stringify(stripLocalIds([row])[0]);
      const rows = listRows(state, action.id).map((row) => {
        const index = sentIndex.get(row.localId);
        if (index === undefined) return row;
        const sent = action.sent[index];
        const saved = matchOf(sent, index);
        if (!saved) return row;
        if (strip(row) === strip(sent)) return { ...saved, localId: row.localId };
        return row.code || action.id === 'subnets' ? row : { ...row, code: saved.code };
      });
      const next = { ...withRows(state, action.id, rows), baseline: action.saved };
      const kept = rows.filter((row) => !isBlankRow(action.id, row));
      return { ...next, dirty: { ...state.dirty, [action.id]: kept.length !== rows.length || !sameAsStored(next, action.id, kept) } };
    }
    default:
      return state;
  }
}
