import type { Translation } from './en';

const de: Translation = {
    common: {
        dialogLabel: 'Integration verbinden',
        close: 'Schließen',
        loading: 'Laden',
        back: 'Zurück',
        finish: 'Fertig',
        tryAgain: 'Erneut versuchen',
        connecting: 'Verbinde...',
        connect: 'Verbinden',
        viewGuide: 'Schritt für Schritt Anleitung anzeigen',
        needHelp: 'Benötigen Sie Hilfe?'
    },
    integrationsList: {
        title: 'Integration auswählen',
        description: 'Bitte wählen Sie eine API-Integration aus der Liste unten aus.',
        noIntegrations: 'Keine Integration gefunden.',
        noIntegrationsDescription:
            'Sie haben noch keine Integration in dieser Umgebung konfiguriert. Fügen Sie Ihre erste Integration im Nango-Dashboard hinzu.',
        connectTo: 'Mit {provider} verbinden',
        error: 'Beim Laden der Konfiguration ist ein Fehler aufgetreten'
    },
    go: {
        linkAccount: '{provider}-Konto verknüpfen',
        fieldDocumentation: 'Dokumentation für {field} anzeigen',
        connect: 'Verbinden',
        success: 'Erfolgreich!',
        successMessage: 'Sie haben Ihre {provider}-Integration erfolgreich eingerichtet.',
        connectionFailed: 'Verbindung fehlgeschlagen',
        connectionErrorGeneric: 'Bei der Autorisierung ist ein Fehler aufgetreten. Bitte wenden Sie sich an unser Support-Team.',
        showErrorDetails: 'Fehlerdetails anzeigen',
        hideErrorDetails: 'Fehlerdetails ausblenden',
        tryAgain: 'Bitte versuchen Sie es erneut',
        backToList: 'Zurück zur Integrationsliste',
        willConnect: 'Wir werden Sie mit {provider} verbinden',
        popupWarning: 'Ein Popup wird geöffnet, stellen Sie sicher, dass Ihr Browser Popups nicht blockiert',
        popupBlocked: 'Das Popup wurde von Ihrem Browser blockiert. Bitte erlauben Sie Popups',
        popupClosed: 'Das Auth-Popup wurde vor Ende des Prozesses geschlossen, bitte versuchen Sie es erneut',
        closeTab: 'Sie können diesen Tab jetzt schließen.',
        authorizationFailed: 'Autorisierung fehlgeschlagen.',
        invalidCredentials: '{provider} hat Ihre Anmeldedaten nicht validiert. Bitte überprüfen Sie die Werte und versuchen Sie es erneut.',
        resourceCapped: 'Sie haben die maximale Anzahl erlaubter Verbindungen erreicht. Bitte wenden Sie sich an den Administrator.',
        invalidPreconfigured: 'Ein vom Administrator festgelegtes vorkonfiguriertes Feld ist ungültig, bitte wenden Sie sich an den Support'
    },
    whatsapp: {
        title: 'Scanne den QR-Code mit WhatsApp',
        step1: 'Öffne WhatsApp auf deinem Telefon.',
        step2: 'Gehe zu Einstellungen → Verknüpfte Geräte → Gerät hinzufügen.',
        step3: 'Richte dein Telefon auf diesen Bildschirm, um den Code zu scannen.',
        generating: 'QR-Code wird erstellt...',
        linking: 'Deine Nummer wird verknüpft...',
        refreshes: 'Der Code wird automatisch aktualisiert.',
        qrTimeout: 'Der QR-Code wurde nicht rechtzeitig gescannt. Bitte versuche es erneut.',
        banned: 'WhatsApp hat diese Nummer gesperrt.',
        failed: 'Die Nummer konnte nicht verknüpft werden. Bitte versuche es erneut.',
        unavailable: 'WhatsApp ist gerade nicht verfügbar. Bitte versuche es später erneut.'
    }
};

export default de;
