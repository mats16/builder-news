FROM public.ecr.aws/lambda/nodejs:16-x86_64 AS build

COPY package.json ${LAMBDA_TASK_ROOT}/

RUN npm install

COPY app.ts tsconfig.json ${LAMBDA_TASK_ROOT}/

RUN $(npm bin)/tsc

FROM public.ecr.aws/lambda/nodejs:16-x86_64

COPY ./fonts/ /etc/fonts/

COPY package.json ${LAMBDA_TASK_ROOT}

RUN npm install --production --cache /tmp/empty-cache && rm -rf /tmp/empty-cache

COPY --from=build ${LAMBDA_TASK_ROOT}/app.js ${LAMBDA_TASK_ROOT}/

ENV LD_LIBRARY_PATH=$LAMBDA_TASK_ROOT/node_modules/canvas/build/Release:/lib64:/usr/lib64:$LAMBDA_RUNTIME_DIR:$LAMBDA_RUNTIME_DIR/lib:$LAMBDA_TASK_ROOT:$LAMBDA_TASK_ROOT/lib:/opt/lib

CMD [ "app.handler" ]
