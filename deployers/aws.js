"use strict";
const Deployer = require("./deployer");
const AWS = require('aws-sdk');
const fs = require('fs');
const crypto = require('crypto');

class AWSDeployer extends Deployer {

	deploy() {
		console.log("Deploying to AWS");
		this._restApiName = this.resources.restApi;
		this._lambdaFunctionName = this.resources.lamdaFunctionName;
		this._lambdaRole = this.resources.lambdaRole;
		this._lambdaTimeout = 3;
		if (this._lambdaRole === undefined || this._restApiName === undefined) {
			throw Error("Need to define LambdaRole and RestApiName at least");
		}
		if (!this._lambdaRole.startsWith("arn:aws")) {
			// Try to get the Role ARN ?
			throw Error("LambdaRole needs to be the ARN of the Role");
		}
		if (this._lambdaFunctionName === undefined) {
			this._lambdaFunctionName = this.resources.restApi;
		}
		if (this.resources.lambdaMemory) {
			this._lambdaMemorySize = this.resources.lambdaMemory;
		} else {
			// Dont handle less well for now
			this._lambdaMemorySize = 512;
		}
		this._awsGateway;
		this._awsLambda;
		if (this.resources.region !== undefined) {
			AWS.config.update({region: this.resources.region});
			console.log('Setting region to: ' + this.resources.region);
		}
		this.region = AWS.config.region;
		AWS.config.update({accessKeyId: this.resources.accessKeyId, secretAccessKey: this.resources.secretAccessKey});
		this._awsGateway = new AWS.APIGateway();
		this._awsLambda = new AWS.Lambda();

		return this.generatePackage().then( () => {
			return this.generateLambda();	
		}).then( () => {
			return this.generateAPIGateway();	
		});
	}

	generatePackage() {
		console.log("Creating package");
		this._package = fs.readFileSync('./lambda.zip');
		var hash = crypto.createHash('sha256');
		this._packageHash =  hash.update(this._package).digest('base64');
		return Promise.resolve();
	}

	createLambdaFunction() {
		console.log("Creating Lambda function");
		var params = {
			MemorySize: this._lambdaMemorySize,
			Code: {
				ZipFile: this._package
			},
			FunctionName: this._lambdaFunctionName,
			Handler: 'entrypoint.handler',
			Role: this._lambdaRole,
			Runtime: 'nodejs4.3',
			Timeout: this._lamdaTimeout,
			'Description': 'Deployed with Webda for API: ' + this._restApiName + '/' + this._packageHash,
			Publish: true
		};
		return this._awsLambda.createFunction(params).promise().then( (fct) => {
			this._lambdaFunction = fct;
			return Promise.resolve(fct);
		});
	}

	removeLambdaPermission(sid) {
		return this._awsLambda.removePermission({'FunctionName': this._lambdaFunctionName, 'StatementId': sid}).promise();
	}

	addLambdaPermission() {
		return this.getLambdaPolicy().then( (p) => {
			var key = 'Webda' + this._packageHash.replace("=","") + this.restApiId;
			var stats = JSON.parse(p.Policy).Statement;
			for (let i in stats) {
				if (stats[i].Sid === key) {
					// Do not update as the policy is already set
					return Promise.resolve();
				}
			}
			console.log("Setting Lambda rights");
			var awsId = this._lambdaFunction.FunctionArn.split(":")[4];
			var params = {
				Action: 'lambda:InvokeFunction',
				FunctionName: this._lambdaFunctionName,
				Principal: 'apigateway.amazonaws.com',
				StatementId: key,
				SourceArn: 'arn:aws:execute-api:' + this.region + ':' + awsId + ':' + this.restApiId + '/*' 
			};
			return this._awsLambda.addPermission(params).promise();
		});
		
		// http://docs.aws.amazon.com/apigateway/latest/developerguide/permissions.html
		// "arn:aws:execute-api:us-east-1:my-aws-account-id:my-api-id/my-stage/GET/my-resource-path"
	}

	getLambdaPolicy() {
		return this._awsLambda.getPolicy({FunctionName: this._lambdaFunctionName}).promise();
	}

	updateLambdaFunction() {
		console.log("Updating Lambda function");
		var params = {FunctionName: this._lambdaFunctionName, ZipFile: this._package, Publish: true};
		return this._awsLambda.updateFunctionCode(params).promise().then( (fct) => {
			var params = {
				MemorySize: this._lambdaMemorySize,
				FunctionName: this._lambdaFunctionName,
				Handler: 'entrypoint.handler',
				Role: this._lambdaRole,
				Runtime: 'nodejs4.3',
				Timeout: this._lamdaTimeout,
				Description: 'Deployed with Webda for API: ' + this._restApiName + '/' + this._packageHash
			};
			return this._awsLambda.updateFunctionConfiguration(params).promise();
		});
	}
	generateLambda() {
		return this._awsLambda.listFunctions().promise().then( (fcts) => {
			for (let i in fcts.Functions) {
				if (fcts.Functions[i].FunctionName == this._lambdaFunctionName) {
					this._lambdaFunction = fcts.Functions[i];
					if (fcts.Functions[i].CodeSha256 == this._packageHash) {
						console.log("Not updating Lambda Function as it has not changed");
						// No need to update the lambda function
						return Promise.resolve();
					}
					return this.updateLambdaFunction();
				}
				// Could handle paging
				return this.createLambdaFunction();
			}
		});
	}

	generateAPIGateway() {
		return this.generateAPIGatewayMapping().then (() => {
			return this.generateAPIGatewayStage();
		}).then( () => {
			return this.addLambdaPermission();
		});
	}

	generateAPIGatewayStage() {
		return this._awsGateway.getStages({restApiId: this.restApiId}).promise().then ( (res) => {
			var stages = res.item;
			for (let i in stages) {
				if (stages[i].stageName == this.deployment.uuid) {
					return Promise.resolve(stages[i]);
				}
			}
			return this._awsGateway.createDeployment({restApiId: this.restApiId, stageName: this.deployment.uuid}).promise().then( (res) => {
				console.log(res);
			});
		});
	}

	generateAPIGatewayMapping() {
		console.log("Creating API Gateway Mapping");
		return this._awsGateway.getRestApis().promise().then( (result) => {
			var resource = null;
			for (var i in result.items) {
				if (result.items[i].name === this._restApiName) {
					resource = result.items[i];
				}
			}
			if (resource === undefined) {
				return this._awsGateway.createRestApi({'name': this._restApiName, 'description': 'Webda Auto Deployed'}).promise();
			}
			return Promise.resolve(resource);
		}).then( (result) => {
			this.restApiId = result.id;
			return this._awsGateway.getResources({'restApiId': this.restApiId, 'limit': 500}).promise();
		}).then( (result) => {
			this._promises = [];
			var found = {};
			var promise = Promise.resolve();
			this.tree = {};
			var toCreate = [];
			this._progression = 0;
			for (let i in result.items) {
				this.tree[result.items[i].path]=Promise.resolve(result.items[i]);
			}
			// Compare with local
			for (let i in this.config) {
				if (i[0] !== '/') continue;
				if (this.tree[i]) {
					found[i] = true;
					promise = promise.then (() => {
						return this.updateAwsResource(this.tree[i], this.config[i])
					});
				} else {
					toCreate.push(this.config[i]);
				}
			}
			// Order to create per path
			toCreate.sort(function(a,b) {
				return a._url.localeCompare(b._url);
			});

			for (let i in toCreate) {
				promise = promise.then (() => {
					return this.createAwsResource(toCreate[i])
				});
				//this._promises.push();
			}
			// Remove old resources
			for (let i in this.tree) {
				if (found[i]) continue;
				promise = promise.then (() => {
					return this.deleteAwsResource(this.tree[i])
				});
				this._promises.push();
			}
			return promise;
		});
	}

	updateAwsResource(remote, local) {
		// For now i am lazy and remove all methods to recreate
		// Need to update template anyway
		var updateResource;
		return remote.then ((resource) => {
			updateResource = resource;
			var promise = Promise.resolve();
			for (let i in resource.resourceMethods) {
				promise = promise.then (() => {
					return this._awsGateway.deleteMethod({'resourceId':resource.id,'restApiId':this.restApiId,'httpMethod':i}).promise();
				});
			}
			return promise;
		}).then (() => {
			if (typeof(local.method) == "string") {
				return this.createAWSMethodResource(updateResource, local, local.method);
			} else {
				return this.createAWSMethodsResource(updateResource, local, local.method);
			}
		});
	}

	deleteAwsResource(remote) {
		return this._awsGateway.deleteResource({'resourceId':remote.id, 'restApiId': this.restApiId}).promise();
	}

	createAWSMethodResource(resource, local, method) {
		return this._awsGateway.putMethod({"authorizationType":"NONE",'resourceId':resource.id,'httpMethod':method, 'restApiId': this.restApiId}).promise().then ((awsMethod) => {
			var params = {'resourceId':resource.id,'integrationHttpMethod': 'POST','httpMethod':method, 'restApiId': this.restApiId, 'type': 'AWS'};
			params.uri = "arn:aws:apigateway:" + this.region + ":lambda:path/2015-03-31/functions/" + this._lambdaFunction.FunctionArn + "/invocations";
			params.requestTemplates={};
			params.requestParameters={};
			params.requestTemplates["application/json"]=this.getRequestTemplates();
			return this._awsGateway.putIntegration(params).promise();
		}).then ( () => {
			var params = {'resourceId':resource.id,'httpMethod':method, 'restApiId': this.restApiId, 'statusCode': '200'};
			params.responseModels = {};
			params.responseModels["application/json"]='Empty';
			return this._awsGateway.putMethodResponse(params).promise();
		}).then ( () => {
			var params = {'resourceId':resource.id,'httpMethod':method, 'restApiId': this.restApiId, 'statusCode': '200'};
			params.responseTemplates={};
			params.responseTemplates["application/json"]=null;
			return this._awsGateway.putIntegrationResponse(params).promise();
		});
	}

	createAWSMethodsResource(resource, local, methods) {
		if (!methods.length) {
			return Promise.resolve();
		}
		// AWS dont like to have too much request at the same time :)
		return this.createAWSMethodResource(resource, local, methods[0]).then( () => {
			return this.createAWSMethodsResource(resource, local, methods.slice(1));
		});
	}

	createAwsResource(local) {
		var i = local._url.indexOf("/",1);
		var promise = this.tree['/'];
		while (i >= 0) {
		  let currentPath = local._url.substr(0,i);
		  promise = promise.then( (item) => {
		    if (this.tree[currentPath] === undefined) {
		    	let pathPart = currentPath.substr(currentPath.lastIndexOf('/')+1);
		    	return this._awsGateway.createResource({'parentId':item.id,'pathPart':pathPart, 'restApiId': this.restApiId}).promise()
		    }
		    return Promise.resolve(this.tree[currentPath]);
		  });
		  i = local._url.indexOf("/", i+1);
		}
		return promise.then( (parent) => {
			let pathPart = local._url.substr(local._url.lastIndexOf('/')+1);
			let params = {'parentId':parent.id,'pathPart':pathPart, 'restApiId': this.restApiId};
			return this.tree[local._url] = this._awsGateway.createResource(params).promise();
		}).then ((resource) => {
			return this.createAWSMethodsResource(resource, local, local.method);
		});
	}

	getRequestTemplates() {
		return  `#set($allParams = $input.params())
		{
		"body-json" : "$input.json('$')",
		"params" : {
		#foreach($type in $allParams.keySet())
		    #set($params = $allParams.get($type))
		"$type" : {
		    #foreach($paramName in $params.keySet())
		    "$paramName" : "$util.escapeJavaScript($params.get($paramName))"
		        #if($foreach.hasNext),#end
		    #end
		}
		    #if($foreach.hasNext),#end
		#end
		},
		"stage-variables" : {
		#foreach($key in $stageVariables.keySet())
		"$key" : "$util.escapeJavaScript($stageVariables.get($key))"
		    #if($foreach.hasNext),#end
		#end
		},
		"context" : {
		    "account-id" : "$context.identity.accountId",
		    "api-id" : "$context.apiId",
		    "api-key" : "$context.identity.apiKey",
		    "authorizer-principal-id" : "$context.authorizer.principalId",
		    "caller" : "$context.identity.caller",
		    "cognito-authentication-provider" : "$context.identity.cognitoAuthenticationProvider",
		    "cognito-authentication-type" : "$context.identity.cognitoAuthenticationType",
		    "cognito-identity-id" : "$context.identity.cognitoIdentityId",
		    "cognito-identity-pool-id" : "$context.identity.cognitoIdentityPoolId",
		    "http-method" : "$context.httpMethod",
		    "stage" : "$context.stage",
		    "source-ip" : "$context.identity.sourceIp",
		    "user" : "$context.identity.user",
		    "user-agent" : "$context.identity.userAgent",
		    "user-arn" : "$context.identity.userArn",
		    "request-id" : "$context.requestId",
		    "resource-id" : "$context.resourceId",
		    "resource-path" : "$context.resourcePath"
		    }
		}`;
	}

}

module.exports = AWSDeployer;