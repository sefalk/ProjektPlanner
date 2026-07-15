/**
 * Detailed milestone help content (V14 / §6.9, Stufe 3). Kept as editable TSX building
 * blocks so the wording/formulas stay maintainable without a Markdown dependency.
 */

export const MILESTONE_INTRO =
  'Meilensteine: monatliche Planung der Stunden je Person aus Budget und Verfügbarkeit. ' +
  'Das €-Budget ist die harte Obergrenze; Stunden folgen aus den Stundensätzen.'

export function MilestoneHelpContent() {
  return (
    <>
      <section>
        <h4 className="font-semibold text-gray-800 mb-1">Grundregeln</h4>
        <ul className="list-disc list-inside space-y-1">
          <li><strong>Budget ist zentral.</strong> Das €-Budget darf nie überschritten werden; idealerweise wird es genau ausgereizt.</li>
          <li><strong>Verfügbarkeit ist der Deckel.</strong> Keine Person wird über ihre netto verfügbare Kapazität (Arbeitstage × h/Woche minus Feiertage, Abwesenheiten, Resturlaub) hinaus verplant.</li>
          <li><strong>Priorität</strong> steuert bei knappem Budget, wer zuerst versorgt wird (kleiner = höher; gleicher Wert = gleiche Stufe; 0 = neutral).</li>
        </ul>
      </section>

      <section>
        <h4 className="font-semibold text-gray-800 mb-1">Kennzahlen</h4>
        <ul className="list-disc list-inside space-y-1">
          <li><strong>Verfügbar</strong>: netto planbare Kapazität der Person im Monat.</li>
          <li><strong>Plan</strong>: bei Anlage festgeschriebene Baseline (historische Referenz).</li>
          <li><strong>Aktuell</strong>: lebender Planwert nach manuellen Anpassungen, Resync und Rebalancing.</li>
          <li><strong>Gebucht</strong>: aus Sage importierte Ist-Stunden.</li>
          <li><strong>Rebalanciert</strong>: Vorschlag, der das Restbudget maximal ausreizt (im Tab „Rebalancing“ anwendbar).</li>
        </ul>
      </section>

      <section>
        <h4 className="font-semibold text-gray-800 mb-1">Verteilungsformel</h4>
        <p>
          Globaler Skalierungsfaktor <code className="px-1 bg-gray-100 rounded">s = min(1, R / C<sub>max</sub>)</code>,
          wobei <code className="px-1 bg-gray-100 rounded">R</code> das Restbudget (Gesamt − abgerechnete gesperrte Monate)
          und <code className="px-1 bg-gray-100 rounded">C<sub>max</sub></code> die Kosten bei voller Kapazität sind.
          Plan-Stunden = Verfügbar × s. So werden Budget und Kapazität nie überschritten.
        </p>
      </section>

      <section>
        <h4 className="font-semibold text-gray-800 mb-1">Durchgerechnetes Beispiel</h4>
        <p className="mb-2">
          Ein Monat, Budget <strong>20.000 €</strong>, zwei Mitarbeiter, je <strong>100 h</strong> verfügbar:
        </p>
        <table className="w-full text-xs border border-gray-200 mb-2">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="px-2 py-1 text-left">Person</th>
              <th className="px-2 py-1 text-left">Satz</th>
              <th className="px-2 py-1 text-left">Verfügbar</th>
              <th className="px-2 py-1 text-left">Plan (ohne Prio)</th>
              <th className="px-2 py-1 text-left">Plan (A vor B)</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-gray-100">
              <td className="px-2 py-1">A</td>
              <td className="px-2 py-1">90 €/h</td>
              <td className="px-2 py-1">100 h</td>
              <td className="px-2 py-1">95,2 h</td>
              <td className="px-2 py-1">100 h</td>
            </tr>
            <tr className="border-t border-gray-100">
              <td className="px-2 py-1">B</td>
              <td className="px-2 py-1">120 €/h</td>
              <td className="px-2 py-1">100 h</td>
              <td className="px-2 py-1">95,2 h</td>
              <td className="px-2 py-1">91,7 h</td>
            </tr>
          </tbody>
        </table>
        <p className="text-xs text-gray-500">
          C<sub>max</sub> = 100·90 + 100·120 = 21.000 €. Ohne Priorität: s = 20.000/21.000 ≈ 0,952 →
          beide × 0,952 (Kosten treffen exakt 20.000 €). Mit Priorität „A vor B“: A voll (9.000 €),
          Rest 11.000 € für B → 11.000/120 ≈ 91,7 h.
        </p>
      </section>
    </>
  )
}
