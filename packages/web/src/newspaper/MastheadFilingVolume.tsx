import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api.ts';

type DailyFilingCount = {
  count: number;
  date: string;
  day: string;
};

type MastheadFilingVolumeProps = {
  editionDate: string;
};

export default function MastheadFilingVolume({ editionDate }: MastheadFilingVolumeProps) {
  const [days, setDays] = useState<Array<DailyFilingCount>>([]);
  const [total, setTotal] = useState<number>(0);

  useEffect(() => {
    apiFetch<Array<DailyFilingCount>>(`/api/stats/weekly-filing-volume?before=${editionDate}`)
      .then((data: Array<DailyFilingCount>) => {
        setDays(data);
        setTotal(data.reduce((sum: number, d: DailyFilingCount) => sum + d.count, 0));
      })
      .catch(() => {
        setDays([]);
        setTotal(0);
      });
  }, [editionDate]);

  const maxCount: number = Math.max(...days.map((d: DailyFilingCount) => d.count), 1);

  if (days.length === 0) {
    return (
      <div className="masthead-widget masthead-filing-volume">
        <span className="masthead-widget-label">Last Week&rsquo;s Volume</span>
        <span className="masthead-widget-note">No filings recorded</span>
      </div>
    );
  }

  return (
    <div className="masthead-widget masthead-filing-volume">
      <span className="masthead-widget-label">Last Week&rsquo;s Volume</span>
      <div className="filing-bars">
        {days.map((d: DailyFilingCount) => (
          <div className="filing-bar-col" key={d.date}>
            <div
              className="filing-bar"
              style={{ height: `${(d.count / maxCount) * 100}%` }}
              title={`${d.day}: ${String(d.count)} filings`}
            />
            <span className="filing-bar-label">{d.day[0]}</span>
          </div>
        ))}
      </div>
      <span className="masthead-widget-note">total: {total}</span>
    </div>
  );
}
