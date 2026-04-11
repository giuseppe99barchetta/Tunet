import ModalOrchestrator from './ModalOrchestrator';

export default function ModalManager({
  core,
  modalState,
  appearance,
  layout,
  onboarding,
  pageManagement,
  entityHelpers,
  addCard,
  cardConfig,
  mediaTick,
}) {
  const {
    entities,
    conn,
    activeUrl,
    connected,
    isPublicMode,
    authRef,
    config,
    setConfig,
    t,
    language,
    setLanguage,
  } = core;

  return (
    <ModalOrchestrator
      entities={entities}
      conn={conn}
      activeUrl={activeUrl}
      connected={connected}
      isPublicMode={isPublicMode}
      authRef={authRef}
      config={config}
      setConfig={setConfig}
      t={t}
      language={language}
      setLanguage={setLanguage}
      modals={modalState}
      appearance={appearance}
      layout={layout}
      onboarding={onboarding}
      pageManagement={pageManagement}
      entityHelpers={entityHelpers}
      addCard={addCard}
      cardConfig={cardConfig}
      mediaTick={mediaTick}
    />
  );
}
