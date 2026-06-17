pipeline {
    agent any

    parameters {
        choice(name: 'ALLOW_DEPLOY', choices: ['no', 'yes'], description: 'Must be yes to run Helm deploy. SCM builds default to no.')
        choice(name: 'CLUSTER', choices: ['dev', 'prod', 'qa', 'integration'], description: 'Target cluster for deploy')
        choice(name: 'ACTION', choices: ['deploy', 'uninstall'], description: 'deploy = install/upgrade, uninstall = helm uninstall')
        string(name: 'CHART_VERSION', defaultValue: '', description: 'Optional chart version override')
        string(name: 'VALUES_FILE', defaultValue: '', description: 'Optional values file name override (e.g. prod-values.yaml)')
    }

    environment {
        CHART_DIR       = 'helm/recipe-detection-chart'
        HELM_CMD        = 'helm'
        KUBE_NAMESPACE  = "${params.CLUSTER}"
        API_URL         = 'http://localhost:8081/api'
    }

    stages {

        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Validate Cluster Access') {
            when {
                expression { params.ALLOW_DEPLOY == 'yes' }
            }
            steps {
                script {
                    if (isUnix()) {
                        sh "kubectl --context=${params.CLUSTER} get nodes"
                    } else {
                        bat "kubectl --context=${params.CLUSTER} get nodes"
                    }
                    echo "Using cluster: ${params.CLUSTER}"
                    echo "Action: ${params.ACTION}"
                }
            }
        }

        stage('Determine Chart Version') {
            when {
                expression { params.ALLOW_DEPLOY == 'yes' }
            }
            steps {
                script {
                    if (params.CHART_VERSION?.trim()) {
                        env.CHART_VERSION = params.CHART_VERSION.trim()
                    } else {
                        def chartYaml = readFile("${CHART_DIR}/Chart.yaml")
                        def versionLine = chartYaml.readLines().find { it.startsWith('version:') }
                        env.CHART_VERSION = versionLine.split(':')[1].trim()
                    }

                    env.RELEASE_NAME = "recipe-${params.CLUSTER}"

                    def valuesFileName = ''
                    if (params.VALUES_FILE?.trim()) {
                        valuesFileName = params.VALUES_FILE.trim()
                    } else {
                        def chartYaml = readFile("${CHART_DIR}/Chart.yaml")
                        def annotationMatcher = (chartYaml =~ /(?m)^\s*recipe-detection\/values-file:\s*(\S+)/)
                        if (annotationMatcher.find()) {
                            valuesFileName = annotationMatcher.group(1)
                        } else {
                            valuesFileName = "values-v${env.CHART_VERSION}.yaml"
                        }
                    }

                    env.VALUES_FILE = "${CHART_DIR}/${valuesFileName}"
                    env.HAS_VERSION_VALUES = fileExists(env.VALUES_FILE) ? 'true' : 'false'

                    echo "Chart Version: ${env.CHART_VERSION}"
                    echo "Values File: ${env.VALUES_FILE}"
                    echo "Release Name: ${env.RELEASE_NAME}"
                }
            }
        }

        stage('Validate Target Cluster') {
            when {
                expression { params.ALLOW_DEPLOY == 'yes' && params.ACTION == 'deploy' }
            }
            steps {
                script {
                    if (env.HAS_VERSION_VALUES != 'true') {
                        error "Values file not found: ${env.VALUES_FILE}"
                    }

                    def valuesContent = readFile(env.VALUES_FILE)
                    def matcher = (valuesContent =~ /(?m)^\s*target_cluster:\s*['"]?([A-Za-z0-9_-]+)['"]?\s*$/)
                    if (matcher.find()) {
                        def targetCluster = matcher.group(1)
                        echo "Values file target_cluster: ${targetCluster}"
                        if (targetCluster != params.CLUSTER) {
                            error "Cluster mismatch: values file targets '${targetCluster}' but CLUSTER parameter is '${params.CLUSTER}'"
                        }
                    } else {
                        echo 'WARNING: values file has no target_cluster field (legacy release). Proceeding with CLUSTER parameter.'
                    }
                }
            }
        }

        stage('Deploy Helm (Config Only)') {
            when {
                expression { params.ALLOW_DEPLOY == 'yes' && params.ACTION == 'deploy' }
            }
            steps {
                script {
                    def valuesArg = "-f ${env.VALUES_FILE}"

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
                                    --create-namespace \\
                                    ${valuesArg}
                            """
                        } else {
                            bat "${HELM_CMD} --kube-context ${params.CLUSTER} upgrade ${RELEASE_NAME} ${CHART_DIR} --namespace ${KUBE_NAMESPACE} --create-namespace ${valuesArg}"
                        }
                        echo "Upgraded Helm release: ${RELEASE_NAME}"
                    } else {
                        if (isUnix()) {
                            sh """
                                ${HELM_CMD} --kube-context ${params.CLUSTER} install ${RELEASE_NAME} ${CHART_DIR} \\
                                    --namespace ${KUBE_NAMESPACE} \\
                                    --create-namespace \\
                                    ${valuesArg}
                            """
                        } else {
                            bat "${HELM_CMD} --kube-context ${params.CLUSTER} install ${RELEASE_NAME} ${CHART_DIR} --namespace ${KUBE_NAMESPACE} --create-namespace ${valuesArg}"
                        }
                        echo "Installed new Helm release: ${RELEASE_NAME}"
                    }
                }
            }
        }

        stage('Verify ConfigMap') {
            when {
                expression { params.ALLOW_DEPLOY == 'yes' && params.ACTION == 'deploy' }
            }
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

        stage('Helm Uninstall') {
            when {
                expression { params.ALLOW_DEPLOY == 'yes' && params.ACTION == 'uninstall' }
            }
            steps {
                script {
                    if (isUnix()) {
                        sh "${HELM_CMD} --kube-context ${params.CLUSTER} uninstall recipe-${params.CLUSTER} --namespace ${KUBE_NAMESPACE} --ignore-not-found"
                    } else {
                        bat "${HELM_CMD} --kube-context ${params.CLUSTER} uninstall recipe-${params.CLUSTER} --namespace ${KUBE_NAMESPACE} --ignore-not-found"
                    }
                    echo "Uninstalled Helm release recipe-${params.CLUSTER} from ${params.CLUSTER}"
                }
            }
        }

        stage('Update Backend Status') {
            when {
                expression { params.ALLOW_DEPLOY == 'yes' && params.ACTION == 'deploy' }
            }
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
            script {
                if (params.ALLOW_DEPLOY == 'yes') {
                    echo "Successfully completed ${params.ACTION} for ${env.RELEASE_NAME} on ${params.CLUSTER}"
                } else {
                    echo 'SCM validation build completed without cluster changes.'
                }
            }
        }
        failure {
            script {
                if (params.ALLOW_DEPLOY == 'yes' && env.CHART_VERSION) {
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
