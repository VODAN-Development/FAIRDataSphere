import { Routes, Route, NavLink } from 'react-router-dom';
import Home from './pages/Home';
import DataInput from './pages/DataInput';
import Items from './pages/Items';
import Reports from './pages/Reports';
import RdfStructure from './pages/RdfStructure';
import Analysis from './pages/Analysis';
import Settings from './pages/Settings';
import About from './pages/About';
import Contact from './pages/Contact';
import Login from './pages/Login';
import './App.css';

function App() {
  return (
    <div className="App">
      <header>
        <h1>Situation Report App</h1>
        <nav>
          <NavLink to="/">Home</NavLink>
          <NavLink to="/data-input">Data input</NavLink>
          <NavLink to="/items">Items</NavLink>
          <NavLink to="/reports">Reports</NavLink>
          <NavLink to="/rdf-structure">RDF structure</NavLink>
          <NavLink to="/analysis">Analysis</NavLink>
          <NavLink to="/settings">Settings</NavLink>
          <NavLink to="/about">About</NavLink>
          <NavLink to="/contact">Contact</NavLink>
          <NavLink to="/login"><button>Login</button></NavLink>
        </nav>
      </header>

      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/data-input" element={<DataInput />} />
        <Route path="/items" element={<Items />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/rdf-structure" element={<RdfStructure />} />
        <Route path="/analysis" element={<Analysis />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/about" element={<About />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/login" element={<Login />} />
      </Routes>
    </div>
  );
}

export default App;
