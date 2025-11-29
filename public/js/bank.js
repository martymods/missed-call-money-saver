(() => {
  // Parse the JWT token from the query string.  When deploying to production
  // you should generate a signed token on the server and include it as
  // ?token=your.jwt.here in the URL.  For testing purposes the sandbox will
  // accept the placeholder 'demo.jwt.token'.
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token') || 'demo.jwt.token';

  // Locate the container in which we will mount Unit's white‑label application.
  const unitRoot = document.getElementById('unit-app');
  if (!unitRoot) return;

  // Define a theme to match the colours defined in our CSS.  The primary
  // colours correspond to Delco Tech's palette.  You can further customise
  // card designs by editing the elementsCard section below.
  const theme = {
    global: {
      colors: {
        primary: '#5a7cff',     // main brand colour
        secondary: '#2a4de2',   // secondary accent colour
        success: '#17d499',     // success/complete actions
        background: '#0c1329',  // match the card background for a seamless feel
        text: '#e8edff'         // ensure text contrasts on dark backgrounds
      },
      buttons: {
        primary: {
          default: {
            borderRadius: '10px',
            fontWeight: '800'
          },
          hover: {
            boxShadow: '0 10px 30px rgba(58, 84, 255, 0.32)'
          }
        }
      }
    },
    elementsCard: {
      designs: [
        {
          name: 'default',
          // The Unit demo asset ensures the card art loads properly in sandbox.
          url: 'https://ui.dev.unit.sh/resources/outlay.png',
          fontColor: '#fafafa'
        }
      ]
    }
  };

  // Instantiate the custom element and apply the JWT token and theme.
  const unitApp = document.createElement('unit-elements-white-label-app');
  unitApp.setAttribute('jwt-token', token);
  unitApp.setAttribute('settings-json', JSON.stringify(theme));

  // Attach the element to the page.  The Unit library will handle user
  // authentication, onboarding, and account provisioning behind the scenes.
  unitRoot.appendChild(unitApp);
})();
