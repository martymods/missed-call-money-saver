(() => {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token') || 'demo.jwt.token';
  const unitRoot = document.getElementById('unit-app');
  const jwtDisplay = document.getElementById('jwtDisplay');
  if (jwtDisplay) jwtDisplay.textContent = token;

  const theme = {
    global: {
      colors: { primary: '#5a7cff', secondary: '#2a4de2', success: '#17d499' },
      buttons: {
        primary: {
          default: { borderRadius: '10px', fontWeight: '800' },
          hover: { boxShadow: '0 10px 30px rgba(58, 84, 255, 0.32)' }
        }
      }
    },
    elementsCard: {
      designs: [
        {
          name: 'default',
          url: 'https://ui.dev.unit.sh/resources/outlay.png',
          fontColor: '#f5f7ff'
        }
      ]
    }
  };

  const unitApp = document.createElement('unit-elements-white-label-app');
  unitApp.setAttribute('jwt-token', token);
  unitApp.setAttribute('settings-json', JSON.stringify(theme));
  unitRoot.append(unitApp);

  const clearButton = document.getElementById('clearUnitStorage');
  if (clearButton) {
    clearButton.addEventListener('click', () => {
      localStorage.removeItem('unitCustomerToken');
      localStorage.removeItem('unitVerifiedCustomerToken');
      alert('Cleared Unit localStorage keys.');
    });
  }
})();
