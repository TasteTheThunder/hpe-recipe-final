pipeline {
    agent any

    parameters {
        choice(name: 'CLUSTER', choices: ['dev', 'prod', 'qa', 'integration'], description: 'Select target cluster')
    }

    environment {
        CHART_DIR       = 'helm/recipe-detection-chart'
        HELM_CMD        = 'helm'
        KUBE_NAMESPACE  = 'default'
        API_URL         = 'http://localhost:8081/api'
    }

    stages {

        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Validate Cluster Access') {
            steps {
                script {
                    if (isUnix()) {
                        sh "kubectl --context=${params.CLUSTER} get nodes"
                    } else {
                        bat "kubectl --context=${params.CLUSTER} get nodes"
                    }
                    echo "Using cluster: ${params.CLUSTER}"
                }
            }
        }

        stage('Determine Chart Version') {
            steps {
                script {
                    def chartYaml = readFile("${CHART_DIR}/Chart.yaml")
                    def versionLine = chartYaml.readLines().find { it.startsWith('version:') }

                    env.CHART_VERSION = versionLine.split(':')[1].trim()
                    env.RELEASE_NAME = "recipe-${params.CLUSTER}-v${env.CHART_VERSION.replace('.', '-')}"

                    env.VALUES_FILE = "${CHART_DIR}/values-v${env.CHART_VERSION}.yaml"
                    env.HAS_VERSION_VALUES = fileExists(env.VALUES_FILE) ? 'true' : 'false'

                    echo "Chart Version: ${env.CHART_VERSION}"
                    echo "Release Name: ${env.RELEASE_NAME}"
                }
            }
        }

        stage('Deploy Helm (Config Only)') {
            steps {
                script {
                    def valuesArg = env.HAS_VERSION_VALUES == 'true'
                        ? "-f ${env.VALUES_FILE}" : ""

                    def releaseExists
                    if (isUnix()) {
                        releaseExists = sh(
                            script: "${HELM_CMD} --kube-context ${params.CLUSTER} status ${RELEASE_NAME} --namespace ${KUBE_NAMESPACE} 2>/dev/null",
                            returnStatus: true
                        ) == 0
                    } else {
                        releaseExists = bat(
                            script: "@echo off\r\n${HELM_CMD} --kube-context ${params.CLUSTER} status ${RELEASE_NAME} --namespace ${KUBE_NAMESPACE} >nul 2>&1",
                            returnStatus: true
                        ) == 0
                    }

                    if (releaseExists) {
                        if (isUnix()) {
                            sh """
                                ${HELM_CMD} --kube-context ${params.CLUSTER} upgrade ${RELEASE_NAME} ${CHART_DIR} \\
                                    --namespace ${KUBE_NAMESPACE} \\
                                    ${valuesArg}
                            """
                        } else {
                            bat "${HELM_CMD} --kube-context ${params.CLUSTER} upgrade ${RELEASE_NAME} ${CHART_DIR} --namespace ${KUBE_NAMESPACE} ${valuesArg}"
                        }
                        echo "Upgraded Helm release: ${RELEASE_NAME}"
                    } else {
                        if (isUnix()) {
                            sh """
                                ${HELM_CMD} --kube-context ${params.CLUSTER} install ${RELEASE_NAME} ${CHART_DIR} \\
                                    --namespace ${KUBE_NAMESPACE} \\
                                    ${valuesArg}
                            """
                        } else {
                            bat "${HELM_CMD} --kube-context ${params.CLUSTER} install ${RELEASE_NAME} ${CHART_DIR} --namespace ${KUBE_NAMESPACE} ${valuesArg}"
                        }
                        echo "Installed new Helm release: ${RELEASE_NAME}"
                    }
                }
            }
        }

        stage('Verify ConfigMap') {
            steps {
                script {
                    if (isUnix()) {
                        sh "${HELM_CMD} --kube-context ${params.CLUSTER} list --namespace ${KUBE_NAMESPACE}"
                        sh "kubectl --context=${params.CLUSTER} get configmaps --namespace ${KUBE_NAMESPACE} -l app.kubernetes.io/instance=${RELEASE_NAME}"
                    } else {
                        bat "${HELM_CMD} --kube-context ${params.CLUSTER} list --namespace ${KUBE_NAMESPACE}"
                        bat "kubectl --context=${params.CLUSTER} get configmaps --namespace ${KUBE_NAMESPACE} -l app.kubernetes.io/instance=${RELEASE_NAME}"
                    }
                }
            }
        }

        stage('Update Backend Status') {
            steps {
                script {
                    if (isUnix()) {
                        sh """
                            curl -s -X PUT ${API_URL}/helm-releases/${env.CHART_VERSION}/status?cluster=${params.CLUSTER} \\
                            -H "Content-Type: application/json" \\
                            -d '{"status":"deployed"}'
                        """
                    } else {
                        bat """
                            curl -s -X PUT "${API_URL}/helm-releases/${env.CHART_VERSION}/status?cluster=${params.CLUSTER}" -H "Content-Type: application/json" -d "{\\"status\\":\\"deployed\\"}"
                        """
                    }
                }
            }
        }
    }

    post {
        success {
            echo "Successfully deployed ${env.RELEASE_NAME} to ${params.CLUSTER}"
        }
        failure {
            script {
                if (env.CHART_VERSION) {
                    if (isUnix()) {
                        sh """
                            curl -s -X PUT ${API_URL}/helm-releases/${env.CHART_VERSION}/status?cluster=${params.CLUSTER} \\
                            -H "Content-Type: application/json" \\
                            -d '{"status":"failed"}' 2>/dev/null
                        """
                    } else {
                        bat """
                            curl -s -X PUT "${API_URL}/helm-releases/${env.CHART_VERSION}/status?cluster=${params.CLUSTER}" -H "Content-Type: application/json" -d "{\\"status\\":\\"failed\\"}" >nul 2>&1
                        """
                    }
                }
            }
        }
        always {
            cleanWs()
        }
    }
}
