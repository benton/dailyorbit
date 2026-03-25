import type { RecentFiling } from '../types.ts';

type YesterdaysFilingsProps = {
  dayLabel: string;
  filings: Array<RecentFiling>;
};

export default function YesterdaysFilings({ dayLabel, filings }: YesterdaysFilingsProps) {
  const heading: string = `${dayLabel}'s Filings`;

  return (
    <div className="grid-filings">
      <h3 className="filings-heading">{heading}</h3>
      {filings.length === 0 ? (
        <p className="filings-empty">No filings recorded.</p>
      ) : (
        <table className="filings-table">
          <thead>
            <tr>
              <th>File Number</th>
              <th>Sub</th>
              <th>Type</th>
              <th>Applicant</th>
              <th>Company</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filings.map((f: RecentFiling) => (
              <tr key={f.file_number}>
                <td className="file-number">
                  <a href={`/filings/${encodeURIComponent(f.file_number)}`}>{f.file_number}</a>
                </td>
                <td>{f.subsystem_code}</td>
                <td>{f.app_type_code}</td>
                <td>{f.address_attention ?? '\u2014'}</td>
                <td>{f.company_name ?? '\u2014'}</td>
                <td>{f.status_code ?? '\u2014'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
