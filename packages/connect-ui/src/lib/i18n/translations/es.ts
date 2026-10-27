import type { Translation } from './en';

const es: Translation = {
    common: {
        dialogLabel: 'Conectar una integración',
        close: 'Cerrar',
        loading: 'Cargando',
        back: 'Atrás',
        finish: 'Finalizar',
        tryAgain: 'Intentar de nuevo',
        connecting: 'Conectando...',
        connect: 'Conectar',
        viewGuide: 'Ver guía de conexión',
        needHelp: '¿Necesitas ayuda?'
    },
    integrationsList: {
        title: 'Seleccionar Integración',
        description: 'Por favor, selecciona una integración de API de la lista a continuación.',
        noIntegrations: 'No se encontró ninguna integración.',
        noIntegrationsDescription: 'No has configurado ninguna integración en este entorno. Agrega tu primera integración en el panel de Tenklo.',
        connectTo: 'Conectar a {provider}',
        error: 'Ocurrió un error al cargar la configuración'
    },
    go: {
        linkAccount: 'Vincular cuenta de {provider}',
        fieldDocumentation: 'Ver la documentación de {field}',
        connect: 'Conectar',
        success: '¡Éxito!',
        successMessage: 'Has configurado exitosamente tu integración con {provider}.',
        connectionFailed: 'Conexión fallida',
        connectionErrorGeneric: 'Ocurrió un error durante la autorización. Por favor, contacta a nuestro equipo de soporte.',
        showErrorDetails: 'Mostrar detalles del error',
        hideErrorDetails: 'Ocultar detalles del error',
        tryAgain: 'Por favor, inténtalo de nuevo',
        backToList: 'Volver a la lista de integraciones',
        willConnect: 'Te conectaremos a {provider}',
        popupWarning: 'Se abrirá una ventana emergente, asegúrate de que tu navegador no bloquee las ventanas emergentes',
        popupBlocked: 'Ventana emergente de autenticación bloqueada por tu navegador, por favor permite las ventanas emergentes',
        popupClosed: 'La ventana emergente de autenticación se cerró antes del final del proceso, por favor inténtalo de nuevo',
        closeTab: 'Ahora puedes cerrar esta pestaña.',
        authorizationFailed: 'Error de autorización.',
        invalidCredentials: '{provider} no validó tus credenciales. Por favor verifica los valores e inténtalo de nuevo.',
        resourceCapped: 'Has alcanzado el número máximo de conexiones permitidas. Por favor contacta al administrador.',
        invalidPreconfigured: 'Un campo preconfigurado establecido por el administrador es inválido, por favor contacta al soporte'
    },
    whatsapp: {
        title: 'Escanea el código QR con WhatsApp',
        step1: 'Abre WhatsApp en tu teléfono.',
        step2: 'Ve a Ajustes → Dispositivos vinculados → Vincular un dispositivo.',
        step3: 'Apunta tu teléfono a esta pantalla para escanear el código.',
        generating: 'Generando el código QR...',
        linking: 'Vinculando tu número...',
        refreshes: 'El código se actualiza automáticamente.',
        qrTimeout: 'El código QR no se escaneó a tiempo. Inténtalo de nuevo.',
        banned: 'WhatsApp bloqueó este número.',
        failed: 'No se pudo vincular el número. Inténtalo de nuevo.',
        unavailable: 'WhatsApp no está disponible en este momento. Inténtalo más tarde.'
    }
};

export default es;
