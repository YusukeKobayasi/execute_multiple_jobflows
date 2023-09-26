っっっっっっっっっっ

import api from 'api';

const LOG_LEVEL = 'DEBUG';

// 並列実行
const jobflowExecRules = [
    { trigger: '64ed85deead0e90011be168a', target: '64ed95ad36c2a400117aa96a' }, // A -> B
    { trigger: '64ed85deead0e90011be168a', target: '64f530ec750b3300114277ef' }, // A -> C
    { trigger: '64ed85deead0e90011be168a', target: '64f5313e83dbb30011ef7b5e' }, // A -> D
    { trigger: '64ed85deead0e90011be168a', target: '64f531bf83dbb30011ef7b94' }, // A -> E
]

// // 順次実行
// const jobflowExecRules = [
//     { trigger: '64ed85deead0e90011be168a', target: '64ed95ad36c2a400117aa96a' }, // A -> B
//     { trigger: '64ed95ad36c2a400117aa96a', target: '64f530ec750b3300114277ef' }, // B -> C
//     { trigger: '64f530ec750b3300114277ef', target: '64f5313e83dbb30011ef7b5e' }, // C -> D
//     { trigger: '64f5313e83dbb30011ef7b5e', target: '64f531bf83dbb30011ef7b94' }, // D -> E
// ]

// APIトークンを設定する
async function get_token(secret , logger) {
    try {
        const { MULTIPLE_JOBFLOW_TRYERROR: token } = await secret.get({
            keys: ['MULTIPLE_JOBFLOW_TRYERROR'],
        });
        return token;
    } catch (err) {
        logger.error(err);
        throw new Error('APIトークンを取得できませんでした'); // エラーを再度スロー
    }
}

// 終了したジョブフローを判別する
async function jobflow_expect(jobflowExecRules , data) {
    let isTrigger = false;
    let isTarget = false;
    let jobQueue = [];
    for(let i=0 ; i<jobflowExecRules.length ; i++) {
        if(data.jsonPayload.data.id === jobflowExecRules[i].trigger) {
            isTrigger = true;
            jobQueue.push(i);
        }
        else if(data.jsonPayload.data.id === jobflowExecRules[i].target) {
            isTarget = true;
        }
    }
    if (!isTrigger && !isTarget) {
        throw new Error("指定したジョブフロー以外が終了しました");
    }
    return {jobQueue , isTrigger , isTarget};
}

// 実行させたいターゲットを取り出す
async function target(jobQueue) {
    const targetsToExecute = jobQueue.map(index => jobflowExecRules[index].target);
    return targetsToExecute;
}

// ジョブフローを実行する
async function jobflow_exe(token , targetsToExecute , logger) {
    try{
        const jobflows_api = api('@dev-karte/v1.0#d9ni2glia2qxp8');
        jobflows_api.auth(token);    
        const res = await Promise.allSettled(
            targetsToExecute.map((jobflow_id) => 
                jobflows_api.postV2DatahubJobflowExec({jobflow_id})
                .then(result => ({...result, jobflow_id}))
            )
        );
        return res;
    }
    catch(err) {
        logger.error(err);
        throw new Error('jobflowを実行できませんでした');
    }
}

// ジョブフローのレスポンス
async function jobuflow_responce(res , logger) {
    let errors = [];
    res.forEach((response) => {
        const value = response.value;
        const jobflow_id = value.jobflow_id;
        if(response.status === 'rejected') {
            logger.error(jobflow_id + "の応答：" + JSON.stringify(response.reason));
            errors.push(jobflow_id + "のジョブフローにエラーがあります");
        } else {
            logger.log(jobflow_id + "の応答：" + JSON.stringify(response.value));
        }
    });
    if(errors.length > 0) {
        throw new Error(errors.join(' , '));
    }
}

// ジョブフローを実行させる処理
export default async function (data, { MODULES }) { 
    const { secret, initLogger } = MODULES;
    const logger = initLogger({logLevel: LOG_LEVEL});

    // 終了したジョブフローを判別する
    const {jobQueue , isTrigger , isTarget} = await jobflow_expect(jobflowExecRules , data);
    // 並列実行で、ターゲットが終了したらファンクションを終了
    if(!isTrigger && isTarget) {
        logger.log(`ターゲットのジョブフロー${data.jsonPayload.data.id}が終了しました`);
        return;
    }
    // 実行させたいターゲットを取り出す
    const targetsToExecute = await target(jobQueue);
    // APIトークンを設定する
    const token = await get_token(secret , logger);
    // ジョブフローを実行する
    const res = await jobflow_exe(token , targetsToExecute , logger);
    // ジョブフローのレスポンス
    await jobuflow_responce(res , logger)
}
