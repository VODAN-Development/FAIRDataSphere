import { Routes, Route, NavLink } from 'react-router-dom';
import Home from './pages/Home';
import DataInput from './pages/DataInput';
import Items from './pages/Items';
import Reports from './pages/Reports';
import RdfStructure from './pages/RdfStructure';
import Account from './pages/Account';
import Organisation from './pages/Organisation';
import About from './pages/About';
import Login from './pages/Login';
import SignUp from './pages/SignUp';
import ProtectedRoute from './auth/ProtectedRoute.jsx';
import { useAuth } from './auth/useAuth.js';
import './App.css';

function App() {
  const { user, signOut } = useAuth();

  return (
    <div className="App">
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

      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/about" element={<About />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<SignUp />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/data-input" element={<DataInput />} />
          <Route path="/items" element={<Items />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/rdf-structure" element={<RdfStructure />} />
          <Route path="/account" element={<Account />} />
          <Route path="/organisation" element={<Organisation />} />
        </Route>
      </Routes>
    </div>
  );
}

export default App;
