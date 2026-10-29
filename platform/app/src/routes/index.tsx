import React from 'react';
import { Routes, Route, Link, useNavigate } from 'react-router-dom';
import { ErrorBoundary, LoadingIndicatorProgress } from '@ohif/ui-next';

// Route Components
import DataSourceWrapper from './DataSourceWrapper';
import WorkList from './WorkList';
import Local from './Local';
import Debug from './Debug';
import NotFound from './NotFound';
import buildModeRoutes from './buildModeRoutes';
import PrivateRoute from './PrivateRoute';
import PropTypes from 'prop-types';
import { routerBasename } from '../utils/publicUrl';
import { useAppConfig } from '@state';
import { history } from '../utils/history';

const NotFoundServer = ({
  message = 'Unable to query for studies at this time. Check your data source configuration or network connection',
}) => {
  return (
    <div className="absolute flex h-full w-full items-center justify-center text-white">
      <div>
        <h4>{message}</h4>
      </div>
    </div>
  );
};

NotFoundServer.propTypes = {
  message: PropTypes.string,
};

const NotFoundStudy = () => {
  const [appConfig] = useAppConfig();
  const { showStudyList } = appConfig;

  // MiniPACS: textos en castellano. Sin lista (paciente) se llega aca si pide un estudio que no es el suyo:
  // el servicio de pase contesta la busqueda vacia.
  return (
    <div className="absolute flex h-full w-full items-center justify-center text-white">
      <div>
        <h4>
          {showStudyList ? 'El estudio pedido no está disponible.' : 'Este estudio no está disponible.'}
        </h4>
        {showStudyList ? (
          <p className="mt-2">
            Volvé a la <Link className="text-primary-light" to="/">lista de estudios</Link> para elegir otro.
          </p>
        ) : (
          <p className="mt-2">Volvé al portal y apretá «Ver estudio».</p>
        )}
      </div>
    </div>
  );
};

NotFoundStudy.propTypes = {
  message: PropTypes.string,
};

// TODO: Include "routes" debug route if dev build
const bakedInRoutes = [
  {
    path: `/notfoundserver`,
    children: NotFoundServer,
  },
  {
    path: `/notfoundstudy`,
    children: NotFoundStudy,
  },
  {
    path: `/debug`,
    children: Debug,
  },
  {
    path: `/local`,
    children: Local.bind(null, { modePath: '' }), // navigate to the worklist
  },
  {
    path: `/localbasic`,
    children: Local.bind(null, { modePath: 'viewer/dicomlocal' }),
  },
];

// Ruta de retorno de OIDC (/callback). La procesa OpenIdConnectRoutes (CallbackPage),
// pero al renderizarse tambien estas rutas caia en el 404 ('*') durante el intercambio
// del token, y se veia 'Error (404)' un instante antes de la lista. Aca se muestra
// el indicador de carga hasta que CallbackPage navega a la pagina de destino.
const OidcCallbackLoading = () => (
  <div className="absolute flex h-full w-full items-center justify-center bg-black">
    <LoadingIndicatorProgress className="h-full w-full bg-black" />
  </div>
);

const _getOidcCallbackPath = () => {
  const oidc = window.config?.oidc;
  if (!oidc?.length) {
    return null;
  }
  const redirectUri = oidc[0].redirect_uri || '/callback';
  const pathname = new URL(redirectUri, window.location.origin).pathname;
  const basename = routerBasename.endsWith('/') ? routerBasename.slice(0, -1) : routerBasename;
  return basename ? pathname.replace(basename, '') : pathname;
};

// NOT FOUND (404)
const notFoundRoute = { path: '*', children: NotFound };

const createRoutes = ({
  modes,
  dataSources,
  extensionManager,
  servicesManager,
  commandsManager,
  hotkeysManager,
  showStudyList,
}: withAppTypes) => {
  const routes =
    buildModeRoutes({
      modes,
      dataSources,
      extensionManager,
      servicesManager,
      commandsManager,
      hotkeysManager,
    }) || [];

  const { customizationService } = servicesManager.services;

  const path =
    routerBasename.length > 1 && routerBasename.endsWith('/')
      ? routerBasename.substring(0, routerBasename.length - 1)
      : routerBasename;

  console.log('Registering worklist route', routerBasename, path);

  const WorkListRoute = {
    path: '/',
    children: DataSourceWrapper,
    private: true,
    props: { children: WorkList, servicesManager, extensionManager },
  };

  const customRoutes = customizationService.getCustomization('routes.customRoutes');

  const oidcCallbackPath = _getOidcCallbackPath();

  const allRoutes = [
    ...routes,
    ...(showStudyList ? [WorkListRoute] : []),
    ...(customRoutes?.routes || []),
    ...bakedInRoutes,
    ...(oidcCallbackPath ? [{ path: oidcCallbackPath, children: OidcCallbackLoading }] : []),
    customRoutes?.notFoundRoute || notFoundRoute,
  ];

  function RouteWithErrorBoundary({ route, ...rest }) {
    const [appConfig] = useAppConfig();
    const { showErrorDetails } = appConfig;

    history.navigate = useNavigate();

    // eslint-disable-next-line react/jsx-props-no-spreading
    return (
      <ErrorBoundary
        context={`Route ${route.path}`}
        showErrorDetails={showErrorDetails}
      >
        <route.children
          {...rest}
          {...route.props}
          route={route}
          servicesManager={servicesManager}
          extensionManager={extensionManager}
          hotkeysManager={hotkeysManager}
        />
      </ErrorBoundary>
    );
  }

  const { userAuthenticationService } = servicesManager.services;

  // All routes are private by default and then we let the user auth service
  // to check if it is enabled or not
  // Todo: I think we can remove the second public return below
  return (
    <Routes>
      {allRoutes.map((route, i) => {
        return route.private === true ? (
          <Route
            key={i}
            path={route.path}
            element={
              <PrivateRoute
                handleUnauthenticated={() => userAuthenticationService.handleUnauthenticated()}
              >
                <RouteWithErrorBoundary route={route} />
              </PrivateRoute>
            }
          ></Route>
        ) : (
          <Route
            key={i}
            path={route.path}
            element={<RouteWithErrorBoundary route={route} />}
          />
        );
      })}
    </Routes>
  );
};

export default createRoutes;
