import type { Translation } from './en';

const fr: Translation = {
    common: {
        dialogLabel: 'Connecter une intégration',
        close: 'Fermer',
        loading: 'Chargement',
        back: 'Retour',
        finish: 'Terminer',
        tryAgain: 'Réessayer',
        connecting: 'Connexion en cours...',
        connect: 'Connecter',
        viewGuide: 'Voir le guide de connexion',
        needHelp: "Besoin d'aide ?"
    },
    integrationsList: {
        title: 'Sélectionner une intégration',
        description: 'Veuillez sélectionner une intégration API dans la liste ci-dessous.',
        noIntegrations: 'Aucune intégration trouvée.',
        noIntegrationsDescription:
            "Vous n'avez pas configuré d'intégration dans cet environnement. Ajoutez votre première intégration dans le tableau de bord Tenklo.",
        connectTo: 'Se connecter à {provider}',
        error: 'Une erreur est survenue lors du chargement de la configuration'
    },
    go: {
        linkAccount: 'Lier le compte {provider}',
        fieldDocumentation: 'Voir la documentation pour {field}',
        connect: 'Connecter',
        success: 'Succès !',
        successMessage: 'Vous avez configuré avec succès votre intégration {provider}.',
        connectionFailed: 'Connexion échouée',
        connectionErrorGeneric: "Une erreur s'est produite lors de l'autorisation. Veuillez contacter notre équipe support.",
        showErrorDetails: "Afficher les détails de l'erreur",
        hideErrorDetails: "Masquer les détails de l'erreur",
        tryAgain: 'Veuillez réessayer',
        backToList: 'Retour à la liste des intégrations',
        willConnect: 'Nous allons vous connecter à {provider}',
        popupWarning: "Une fenêtre pop-up va s'ouvrir, veuillez vous assurer que votre navigateur ne bloque pas les pop-ups",
        popupBlocked: "La fenêtre d'authentification a été bloquée par votre navigateur, veuillez autoriser les pop-ups",
        popupClosed: "La fenêtre d'authentification a été fermée avant la fin du processus, veuillez réessayer",
        closeTab: 'Vous pouvez maintenant fermer cet onglet.',
        authorizationFailed: "Échec de l'autorisation.",
        invalidCredentials: "{provider} n'a pas validé vos identifiants. Veuillez vérifier les valeurs et réessayer.",
        resourceCapped: "Vous avez atteint le nombre maximum de connexions autorisées. Veuillez contacter l'administrateur.",
        invalidPreconfigured: "Un champ préconfiguré par l'administrateur n'est pas valide, veuillez contacter le support"
    },
    whatsapp: {
        title: 'Scannez le code QR avec WhatsApp',
        step1: 'Ouvrez WhatsApp sur votre téléphone.',
        step2: 'Allez dans Paramètres → Appareils connectés → Connecter un appareil.',
        step3: 'Pointez votre téléphone vers cet écran pour scanner le code.',
        generating: 'Génération du code QR...',
        linking: 'Connexion de votre numéro...',
        refreshes: 'Le code se met à jour automatiquement.',
        qrTimeout: "Le code QR n'a pas été scanné à temps. Veuillez réessayer.",
        banned: 'WhatsApp a bloqué ce numéro.',
        failed: "Le numéro n'a pas pu être connecté. Veuillez réessayer.",
        unavailable: "WhatsApp n'est pas disponible pour le moment. Veuillez réessayer plus tard."
    }
};

export default fr;
