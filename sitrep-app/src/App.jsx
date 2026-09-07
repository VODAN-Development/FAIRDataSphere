import { lazy, Suspense } from 'react';
import { Routes, Route, NavLink } from 'react-router-dom';
import ProtectedRoute from './auth/ProtectedRoute.jsx';
import { useAuth } from './auth/useAuth.js';
import './App.css';

const Home = lazy(() => import('./pages/Home'));
const DataInput = lazy(() => import('./pages/DataInput'));
const Items = lazy(() => import('./pages/Items'));
const Reports = lazy(() => import('./pages/Reports'));
const RdfStructure = lazy(() => import('./pages/RdfStructure'));
const Account = lazy(() => import('./pages/Account'));
const Organisation = lazy(() => import('./pages/Organisation'));
const About = lazy(() => import('./pages/About'));
const Login = lazy(() => import('./pages/Login'));
const SignUp = lazy(() => import('./pages/SignUp'));

function App() {
  const { user, signOut } = useAuth();

  return (
    <div className="App">
      {/* Top-level navigation stays visible across pages; protected links appear
          only after the auth provider has a current user. */}
      <header>
        <h1>FAIR Data Sphere</h1>
        <nav>
          <NavLink to="/">Home</NavLink>
          <NavLink to="/data-input">Data input</NavLink>
          <NavLink to="/items">Items</NavLink>
          <NavLink to="/reports">Reports</NavLink>
          <NavLink to="/rdf-structure">RDF structure</NavLink>
          {user && <NavLink to="/account">Account</NavLink>}
          {user && <NavLink to="/organisation">Organisation</NavLink>}
          <NavLink to="/about">About</NavLink>
          {user ? (
            <button type="button" className="nav-button" onClick={signOut}>
              Sign out
            </button>
          ) : (
            <NavLink to="/login">Login</NavLink>
          )}
        </nav>
      </header>

      <Suspense fallback={<main className="page"><p>Loading...</p></main>}>
        <Routes>
          {/* Public routes can be visited before the session check completes. */}
          <Route path="/" element={<Home />} />
          <Route path="/about" element={<About />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<SignUp />} />
          {/* ProtectedRoute gates all data-management surfaces behind sign-in. */}
          <Route element={<ProtectedRoute />}>
            <Route path="/data-input" element={<DataInput />} />
            <Route path="/items" element={<Items />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/rdf-structure" element={<RdfStructure />} />
            <Route path="/account" element={<Account />} />
            <Route path="/organisation" element={<Organisation />} />
          </Route>
        </Routes>
      </Suspense>
    </div>
  );
}

export default App;
