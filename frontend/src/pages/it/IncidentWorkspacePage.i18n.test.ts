import { describe, expect, it } from 'vitest';
import de from '../../locales/de/it.json';
import es from '../../locales/es/it.json';

const incidentEs = es.workspace.incident;
const incidentDe = de.workspace.incident;

describe('incident workspace journal and reporter words', () => {
  it('names the Spanish journal Diario and keeps the register as Registro', () => {
    expect(incidentEs.tabs.journal).toBe('Diario');
    expect(incidentEs.backLabel).toBe('Registro de incidentes');
    expect(incidentEs.journal.placeholder).toBe('Añadir una nota al diario');
    expect(incidentEs.messages.entryFailed).toBe('Error al añadir la entrada del diario');
    expect(incidentEs.dialogs.reopenMessage).toContain('anotado en el diario');
    expect(incidentEs.dialogs.cancelMessage).toContain('anotado en el diario');
    expect(incidentEs.journal.unrestricted).toBe('Abierto al registro');
  });

  it('uses Notificante for the Spanish reporter in the field, the hint and the lose-access message', () => {
    expect(incidentEs.drawer.reporter).toBe('Notificante');
    expect(incidentEs.drawer.restrictAccessHint).toContain('el notificante');
    expect(incidentEs.dialogs.loseAccessMessage).toContain('el notificante');
    expect(JSON.stringify(es)).not.toMatch(/declarante/i);
  });

  it('uses Melder for the German reporter in the field, the hint and the lose-access message', () => {
    expect(incidentDe.drawer.reporter).toBe('Melder');
    expect(incidentDe.tabs.journal).toBe('Verlauf');
    expect(incidentDe.drawer.restrictAccessHint).toContain('der Melder');
    expect(incidentDe.dialogs.loseAccessMessage).toContain('der Melder');
    expect(JSON.stringify(de)).not.toMatch(/Meldende/);
  });
});
