import { AnchorHTMLAttributes, lazy, Suspense } from 'react';
import { LinkProps, Link as ReactRouterLink, Route, Routes } from 'react-router';
import AdminLayout from './admin/AdminLayout.tsx';
import ConfigEditor from './admin/ConfigEditor.tsx';
import Dashboard from './admin/Dashboard.tsx';
import EarthStationDetail from './earth-stations/EarthStationDetail.tsx';
import FilingDetail from './filings/FilingDetail.tsx';
import SatelliteDetail from './satellites/SatelliteDetail.tsx';
import SearchPage from './search/SearchPage.tsx';
import PublicLayout from './ui/PublicLayout.tsx';

const HomePage = lazy(() => import('./home/HomePage.tsx'));
const Companies = lazy(() => import('./admin/Companies.tsx'));
const CompanyDetail = lazy(() => import('./companies/CompanyDetail.tsx'));

const Link = ({ className, ...props }: LinkProps & AnchorHTMLAttributes<HTMLAnchorElement>) => (
  <ReactRouterLink
    className={
      'text-pink-700 underline hover:no-underline dark:text-pink-400' +
      (className ? ` ${className}` : '')
    }
    {...props}
  />
);

const About = () => (
  <div className="m-6 mx-auto w-8/12 rounded-sm border border-gray-200 p-4 shadow-md dark:border-neutral-600 dark:bg-neutral-800 dark:shadow-none">
    <h1 className="text-4xl">
      <fbt desc="About">About</fbt>
    </h1>
    <p className="my-4">
      <Link to="/">
        <fbt desc="Back to home link">Home</fbt>
      </Link>
    </p>
  </div>
);

export default function App() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route
          element={
            <Suspense fallback={<p className="text-sm text-neutral-500">Loading...</p>}>
              <HomePage />
            </Suspense>
          }
          path="/"
        />
        <Route element={<About />} path="/about" />
        <Route element={<SearchPage />} path="/search" />
        <Route element={<FilingDetail />} path="/filings/:fileNumber" />
        <Route element={<SatelliteDetail />} path="/satellites/:id" />
        <Route element={<EarthStationDetail />} path="/earth-stations/:callsign" />
        <Route
          element={
            <Suspense fallback={<p className="text-sm text-neutral-500">Loading...</p>}>
              <CompanyDetail />
            </Suspense>
          }
          path="/companies/:id"
        />
      </Route>
      <Route element={<AdminLayout />} path="/admin">
        <Route element={<Dashboard />} index />
        <Route element={<ConfigEditor />} path="config" />
        <Route
          element={
            <Suspense fallback={<p className="text-sm text-neutral-500">Loading...</p>}>
              <Companies />
            </Suspense>
          }
          path="companies"
        />
      </Route>
    </Routes>
  );
}
