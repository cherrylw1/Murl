// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../../preload/index.d.ts" />
import React, { useEffect, useState } from 'react';

function App(): JSX.Element {
  const [health, setHealth] = useState<string>('loading...');

  useEffect(() => {
    window.murl
      .engineHealth()
      .then((res: string) => setHealth(res))
      .catch((err: unknown) => setHealth(`Error: ${err}`));
  }, []);

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>Murl — shell online</h1>
      <p>
        Engine status: <strong>{health}</strong>
      </p>
    </div>
  );
}

export default App;
