import { Link } from 'react-router-dom';

export default function Home() {
  return (
    <div className='homepage'>
      <main>
        <section className="welcome-section">
          <h2>Welcome to the Situation Report App</h2>
          <p>Use this app to create and manage situation reports for various incidents and events.</p>
          <Link to="/data-input"><button>Create new situation</button></Link>
        </section>
      </main>
    </div>
  );
}
